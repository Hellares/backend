import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../../configuracion-codigos/configuracion-codigos.service';
import { createCursorPaginatedResponse } from '../../common/utils/pagination.util';
import {
  CreateOrdenCompraDto,
  CreateOrdenCompraDetalleDto,
  UpdateOrdenCompraDto,
  UpdateEstadoOrdenCompraDto,
  QueryOrdenesCompraDto,
} from '../dto';
import { EstadoOrdenCompra, Prisma } from '@prisma/client';

@Injectable()
export class OrdenCompraService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(OrdenCompraService.name);
  }

  /**
   * Crear Orden de Compra con detalles
   */
  async create(empresaId: string, dto: CreateOrdenCompraDto, usuarioId: string) {
    this.logger.info('Creando orden de compra', { empresaId, proveedor: dto.proveedorId });

    return this.prisma.$transaction(async (tx) => {
      // Obtener proveedor para snapshot
      const proveedor = await tx.proveedor.findFirst({
        where: { id: dto.proveedorId, empresaId },
      });

      if (!proveedor) {
        throw new NotFoundException('Proveedor no encontrado');
      }

      // Generar código
      const codigo = await this.configuracionCodigos.generarCodigoOrdenCompra(
        empresaId,
        tx,
      );

      // Calcular detalles
      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index),
      );

      // Calcular totales del header
      const subtotal = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
      const totalDescuento = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
      const totalImpuestos = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      const ordenCompra = await tx.ordenCompra.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          proveedorId: dto.proveedorId,
          codigo,
          // Snapshot proveedor
          nombreProveedor: proveedor.nombre,
          documentoProveedor: proveedor.numeroDocumento,
          emailProveedor: proveedor.email,
          telefonoProveedor: proveedor.telefono,
          direccionProveedor: proveedor.direccion,
          // Términos
          terminosPago: dto.terminosPago ?? proveedor.terminosPago,
          diasCredito: dto.diasCredito ?? proveedor.diasCredito,
          // Moneda
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          // Montos
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          // Fechas
          fechaEntregaEsperada: dto.fechaEntregaEsperada
            ? new Date(dto.fechaEntregaEsperada)
            : null,
          // Textos
          observaciones: dto.observaciones,
          condiciones: dto.condiciones,
          creadoPor: usuarioId,
          detalles: {
            create: detallesCalculados.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              subtotal: d.subtotal,
              total: d.total,
              cantidadRecibida: 0,
              cantidadPendiente: d.cantidad,
              orden: d.orden,
            })),
          },
        },
        include: this.getInclude(),
      });

      this.logger.log(`Orden de compra creada: ${ordenCompra.codigo}`);
      return ordenCompra;
    });
  }

  /**
   * Listar órdenes de compra con filtros y paginación
   */
  async findAll(empresaId: string, filtros?: QueryOrdenesCompraDto) {
    const where: Prisma.OrdenCompraWhereInput = { empresaId };

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;
    if (filtros?.estado) where.estado = filtros.estado;

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.creadoEn = {};
      if (filtros.fechaDesde) where.creadoEn.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) where.creadoEn.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { startsWith: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const limit = filtros?.limit ?? 10;

    const paginationArgs: Prisma.OrdenCompraFindManyArgs = filtros?.cursor
      ? { cursor: { id: filtros.cursor }, skip: 1, take: limit }
      : { take: limit };

    const [data, total] = await Promise.all([
      this.prisma.ordenCompra.findMany({
        where,
        include: {
          sede: { select: { id: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true, codigo: true } },
          _count: { select: { detalles: true, compras: true } },
        },
        orderBy: { creadoEn: 'desc' },
        ...paginationArgs,
      }),
      this.prisma.ordenCompra.count({ where }),
    ]);

    return createCursorPaginatedResponse(data, total, limit, (item) => item.id);
  }

  /**
   * Obtener detalle de una OC
   */
  async findOne(id: string, empresaId: string) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      include: this.getInclude(),
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    return oc;
  }

  /**
   * Actualizar OC (solo BORRADOR)
   */
  async update(
    id: string,
    empresaId: string,
    dto: UpdateOrdenCompraDto,
    usuarioId: string,
  ) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    if (oc.estado !== EstadoOrdenCompra.BORRADOR) {
      throw new BadRequestException(
        'Solo se puede editar una OC en estado BORRADOR',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Si cambia proveedor, actualizar snapshot
      let snapshotData = {};
      if (dto.proveedorId && dto.proveedorId !== oc.proveedorId) {
        const proveedor = await tx.proveedor.findFirst({
          where: { id: dto.proveedorId, empresaId },
        });
        if (!proveedor) {
          throw new NotFoundException('Proveedor no encontrado');
        }
        snapshotData = {
          proveedorId: dto.proveedorId,
          nombreProveedor: proveedor.nombre,
          documentoProveedor: proveedor.numeroDocumento,
          emailProveedor: proveedor.email,
          telefonoProveedor: proveedor.telefono,
          direccionProveedor: proveedor.direccion,
        };
      }

      // Si se envían detalles, reemplazar todos
      let montosData = {};
      if (dto.detalles && dto.detalles.length > 0) {
        // Eliminar detalles anteriores
        await tx.ordenCompraDetalle.deleteMany({
          where: { ordenCompraId: id },
        });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        // Crear nuevos detalles
        await tx.ordenCompraDetalle.createMany({
          data: detallesCalculados.map((d) => ({
            ordenCompraId: id,
            productoId: d.productoId,
            varianteId: d.varianteId,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            descuento: d.descuento,
            porcentajeIGV: d.porcentajeIGV,
            igv: d.igv,
            subtotal: d.subtotal,
            total: d.total,
            cantidadRecibida: 0,
            cantidadPendiente: d.cantidad,
            orden: d.orden,
          })),
        });

        const subtotal = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
        const totalDescuento = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
        const totalImpuestos = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
        const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

        montosData = { subtotal, descuento: totalDescuento, impuestos: totalImpuestos, total };
      }

      const updated = await tx.ordenCompra.update({
        where: { id },
        data: {
          ...snapshotData,
          ...montosData,
          terminosPago: dto.terminosPago ?? oc.terminosPago,
          diasCredito: dto.diasCredito ?? oc.diasCredito,
          moneda: dto.moneda ?? oc.moneda,
          tipoCambio: dto.tipoCambio ?? oc.tipoCambio,
          fechaEntregaEsperada: dto.fechaEntregaEsperada
            ? new Date(dto.fechaEntregaEsperada)
            : oc.fechaEntregaEsperada,
          observaciones: dto.observaciones ?? oc.observaciones,
          condiciones: dto.condiciones ?? oc.condiciones,
          actualizadoPor: usuarioId,
        },
        include: this.getInclude(),
      });

      return updated;
    });
  }

  /**
   * Cambiar estado de la OC (máquina de estados)
   */
  async updateEstado(
    id: string,
    empresaId: string,
    dto: UpdateEstadoOrdenCompraDto,
    usuarioId: string,
  ) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    // Validar transiciones permitidas
    const transicionesPermitidas: Record<EstadoOrdenCompra, EstadoOrdenCompra[]> = {
      [EstadoOrdenCompra.BORRADOR]: [EstadoOrdenCompra.PENDIENTE, EstadoOrdenCompra.CANCELADA],
      [EstadoOrdenCompra.PENDIENTE]: [EstadoOrdenCompra.APROBADA, EstadoOrdenCompra.CANCELADA],
      [EstadoOrdenCompra.APROBADA]: [], // PARCIAL y COMPLETADA se actualizan internamente
      [EstadoOrdenCompra.PARCIAL]: [],
      [EstadoOrdenCompra.COMPLETADA]: [],
      [EstadoOrdenCompra.CANCELADA]: [],
    };

    if (!transicionesPermitidas[oc.estado]?.includes(dto.estado)) {
      throw new BadRequestException(
        `No se puede cambiar de ${oc.estado} a ${dto.estado}`,
      );
    }

    const updateData: Prisma.OrdenCompraUpdateInput = {
      estado: dto.estado,
      actualizadoPor: usuarioId,
    };

    if (dto.estado === EstadoOrdenCompra.APROBADA) {
      updateData.fechaAprobacion = new Date();
      updateData.aprobadoPor = usuarioId;
    }

    return this.prisma.ordenCompra.update({
      where: { id },
      data: updateData,
      include: this.getInclude(),
    });
  }

  /**
   * Eliminar OC (solo BORRADOR)
   */
  async remove(id: string, empresaId: string) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    if (oc.estado !== EstadoOrdenCompra.BORRADOR) {
      throw new BadRequestException(
        'Solo se puede eliminar una OC en estado BORRADOR',
      );
    }

    await this.prisma.ordenCompra.delete({ where: { id } });
    return { message: 'Orden de compra eliminada' };
  }

  /**
   * Obtener líneas pendientes de recepción de una OC
   */
  async getLineasPendientes(id: string, empresaId: string) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          where: { cantidadPendiente: { gt: 0 } },
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
          orderBy: { orden: 'asc' },
        },
      },
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    return oc.detalles;
  }

  /**
   * Duplicar OC como BORRADOR
   */
  async duplicar(id: string, empresaId: string, usuarioId: string) {
    const oc = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      include: { detalles: { orderBy: { orden: 'asc' } } },
    });

    if (!oc) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      const codigo = await this.configuracionCodigos.generarCodigoOrdenCompra(
        empresaId,
        tx,
      );

      const nueva = await tx.ordenCompra.create({
        data: {
          empresaId,
          sedeId: oc.sedeId,
          proveedorId: oc.proveedorId,
          codigo,
          nombreProveedor: oc.nombreProveedor,
          documentoProveedor: oc.documentoProveedor,
          emailProveedor: oc.emailProveedor,
          telefonoProveedor: oc.telefonoProveedor,
          direccionProveedor: oc.direccionProveedor,
          terminosPago: oc.terminosPago,
          diasCredito: oc.diasCredito,
          moneda: oc.moneda,
          tipoCambio: oc.tipoCambio,
          subtotal: oc.subtotal,
          descuento: oc.descuento,
          impuestos: oc.impuestos,
          total: oc.total,
          observaciones: oc.observaciones,
          condiciones: oc.condiciones,
          creadoPor: usuarioId,
          detalles: {
            create: oc.detalles.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              subtotal: d.subtotal,
              total: d.total,
              cantidadRecibida: 0,
              cantidadPendiente: d.cantidad,
              orden: d.orden,
            })),
          },
        },
        include: this.getInclude(),
      });

      this.logger.log(`OC duplicada: ${oc.codigo} -> ${nueva.codigo}`);
      return nueva;
    });
  }

  /**
   * Actualizar estado de OC por recepción (uso interno)
   */
  async actualizarEstadoPorRecepcion(
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    const detalles = await tx.ordenCompraDetalle.findMany({
      where: { ordenCompraId: id },
    });

    const todasCompletas = detalles.every((d) => d.cantidadPendiente <= 0);
    const algunaRecibida = detalles.some((d) => d.cantidadRecibida > 0);

    let nuevoEstado: EstadoOrdenCompra;
    if (todasCompletas) {
      nuevoEstado = EstadoOrdenCompra.COMPLETADA;
    } else if (algunaRecibida) {
      nuevoEstado = EstadoOrdenCompra.PARCIAL;
    } else {
      return; // Sin cambios
    }

    await tx.ordenCompra.update({
      where: { id },
      data: { estado: nuevoEstado },
    });

    this.logger.log(`OC ${id} actualizada a ${nuevoEstado} por recepción`);
  }

  /**
   * Calcular montos de un detalle
   */
  private calcularDetalle(dto: CreateOrdenCompraDetalleDto, index: number) {
    const cantidad = dto.cantidad;
    const precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;

    const subtotalBruto = cantidad * precioUnitario;
    const subtotal = subtotalBruto - descuento;
    const igv = subtotal * (porcentajeIGV / 100);
    const total = subtotal + igv;

    return {
      productoId: dto.productoId || null,
      varianteId: dto.varianteId || null,
      descripcion: dto.descripcion,
      cantidad,
      precioUnitario,
      descuento,
      porcentajeIGV,
      igv: Math.round(igv * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      orden: index,
    };
  }

  /**
   * Include estándar para queries
   */
  private getInclude() {
    return {
      detalles: {
        include: {
          producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
          variante: { select: { id: true, nombre: true, sku: true } },
        },
        orderBy: { orden: 'asc' as const },
      },
      sede: { select: { id: true, nombre: true } },
      proveedor: { select: { id: true, nombre: true, codigo: true } },
      compras: {
        select: { id: true, codigo: true, estado: true },
      },
    };
  }
}
