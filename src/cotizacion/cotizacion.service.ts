import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CompatibilidadService } from '../producto/compatibilidad.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { UpdateEstadoCotizacionDto } from './dto/update-estado-cotizacion.dto';
import { CreateCotizacionDetalleDto } from './dto/create-cotizacion-detalle.dto';
import { EstadoCotizacion, Prisma, Rol, TipoNotificacion } from '@prisma/client';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { NotificacionService } from '../notificacion/notificacion.service';

@Injectable()
export class CotizacionService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    private readonly compatibilidadService: CompatibilidadService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly notificacionService: NotificacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CotizacionService.name);
  }

  /**
   * Crear cotizacion con detalles en transaccion
   */
  async create(empresaId: string, dto: CreateCotizacionDto) {
    this.logger.info('Creando cotizacion', { empresaId, sede: dto.sedeId });

    // Verificar límite de cotizaciones del plan de suscripción
    await this.planLimitsService.checkCotizacionesLimit(empresaId);

    return this.prisma.$transaction(async (tx) => {
      // Generar codigo
      const { codigoCotizacion } =
        await this.configuracionCodigos.generarCodigoCotizacion(
          empresaId,
          dto.sedeId,
          tx,
        );

      // Calcular totales por linea
      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index),
      );

      // Validar descuentos máximos por producto
      const detallesConDescuento = detallesCalculados.filter(d => d.descuento > 0 && d.productoId);
      if (detallesConDescuento.length > 0) {
        const productoIds = [...new Set(detallesConDescuento.map(d => d.productoId!))];
        const productosConLimite = await tx.producto.findMany({
          where: { id: { in: productoIds }, descuentoMaximo: { not: null }, esCombo: false },
          select: { id: true, descuentoMaximo: true },
        });
        const limiteMap = new Map(productosConLimite.map(p => [p.id, Number(p.descuentoMaximo)]));

        for (const detalle of detallesConDescuento) {
          const limite = limiteMap.get(detalle.productoId!);
          if (limite != null && limite > 0) {
            const subtotalBruto = detalle.cantidad * detalle.precioUnitario;
            const porcentaje = subtotalBruto > 0 ? (detalle.descuento / subtotalBruto) * 100 : 0;
            if (porcentaje > limite) {
              throw new BadRequestException(
                `Descuento de "${detalle.descripcion}" (${porcentaje.toFixed(1)}%) excede el máximo permitido (${limite}%)`,
              );
            }
          }
        }
      }

      // Calcular totales del header
      const subtotal = detallesCalculados.reduce(
        (sum, d) => sum + d.subtotal,
        0,
      );
      const totalDescuento = detallesCalculados.reduce(
        (sum, d) => sum + d.descuento,
        0,
      );
      const totalImpuestos = detallesCalculados.reduce(
        (sum, d) => sum + d.igv,
        0,
      );
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      const cotizacion = await tx.cotizacion.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          clienteId: dto.clienteId,
          vendedorId: dto.vendedorId,
          codigo: codigoCotizacion,
          nombre: dto.nombre,
          nombreCliente: dto.nombreCliente,
          documentoCliente: dto.documentoCliente,
          emailCliente: dto.emailCliente,
          telefonoCliente: dto.telefonoCliente,
          direccionCliente: dto.direccionCliente,
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          fechaVencimiento: dto.fechaVencimiento
            ? new Date(dto.fechaVencimiento)
            : null,
          observaciones: dto.observaciones,
          condiciones: dto.condiciones,
          detalles: {
            create: detallesCalculados.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              icbper: d.icbper,
              subtotal: d.subtotal,
              total: d.total,
              orden: d.orden,
            })),
          },
        },
        include: {
          detalles: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
              servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
            },
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          cliente: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
          vendedor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      this.logger.log(`Cotizacion creada: ${cotizacion.codigo}`);
      return cotizacion;
    });
  }

  /**
   * Listar cotizaciones con filtros
   */
  async findAll(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoCotizacion;
      fechaDesde?: string;
      fechaHasta?: string;
      clienteId?: string;
      search?: string;
      userId?: string;
      userRole?: string;
    },
  ) {
    const where: Prisma.CotizacionWhereInput = { empresaId };

    // Vendedor solo ve sus propias cotizaciones
    if (filtros?.userRole === Rol.VENDEDOR && filtros?.userId) {
      where.vendedorId = filtros.userId;
    }

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.clienteId) where.clienteId = filtros.clienteId;

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaEmision = {};
      if (filtros.fechaDesde) where.fechaEmision.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) where.fechaEmision.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
        { documentoCliente: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.cotizacion.findMany({
      where,
      include: {
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        vendedor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        _count: { select: { detalles: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  /**
   * Detalle completo de una cotizacion
   */
  async findOne(id: string, empresaId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
            servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
          },
          orderBy: { orden: 'asc' },
        },
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true, dni: true } },
          },
        },
        vendedor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    return cotizacion;
  }

  /**
   * Actualizar cotizacion (solo si BORRADOR)
   */
  async update(id: string, empresaId: string, dto: UpdateCotizacionDto) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    if (cotizacion.estado !== EstadoCotizacion.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden editar cotizaciones en estado BORRADOR',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Si vienen detalles nuevos, reemplazar los existentes
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.cotizacionDetalle.deleteMany({
          where: { cotizacionId: id },
        });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        await tx.cotizacionDetalle.createMany({
          data: detallesCalculados.map((d) => ({
            cotizacionId: id,
            productoId: d.productoId,
            varianteId: d.varianteId,
            servicioId: d.servicioId,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            descuento: d.descuento,
            tipoAfectacion: d.tipoAfectacion,
            porcentajeIGV: d.porcentajeIGV,
            igv: d.igv,
            icbper: d.icbper,
            subtotal: d.subtotal,
            total: d.total,
            orden: d.orden,
          })),
        });

        const subtotal = detallesCalculados.reduce(
          (sum, d) => sum + d.subtotal,
          0,
        );
        const totalDescuento = detallesCalculados.reduce(
          (sum, d) => sum + d.descuento,
          0,
        );
        const totalImpuestos = detallesCalculados.reduce(
          (sum, d) => sum + d.igv,
          0,
        );
        const total = detallesCalculados.reduce(
          (sum, d) => sum + d.total,
          0,
        );

        return tx.cotizacion.update({
          where: { id },
          data: {
            ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
            ...(dto.vendedorId !== undefined && { vendedorId: dto.vendedorId }),
            ...(dto.nombre !== undefined && { nombre: dto.nombre }),
            ...(dto.nombreCliente !== undefined && { nombreCliente: dto.nombreCliente }),
            ...(dto.documentoCliente !== undefined && { documentoCliente: dto.documentoCliente }),
            ...(dto.emailCliente !== undefined && { emailCliente: dto.emailCliente }),
            ...(dto.telefonoCliente !== undefined && { telefonoCliente: dto.telefonoCliente }),
            ...(dto.direccionCliente !== undefined && { direccionCliente: dto.direccionCliente }),
            ...(dto.moneda !== undefined && { moneda: dto.moneda }),
            ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
            ...(dto.observaciones !== undefined && { observaciones: dto.observaciones }),
            ...(dto.condiciones !== undefined && { condiciones: dto.condiciones }),
            ...(dto.fechaVencimiento !== undefined && {
              fechaVencimiento: dto.fechaVencimiento
                ? new Date(dto.fechaVencimiento)
                : null,
            }),
            subtotal,
            descuento: totalDescuento,
            impuestos: totalImpuestos,
            total,
          },
          include: {
            detalles: {
              include: {
                producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
                variante: { select: { id: true, nombre: true, sku: true } },
                servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
              },
              orderBy: { orden: 'asc' },
            },
            sede: { select: { id: true, nombre: true } },
            vendedor: {
              select: {
                id: true,
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        });
      }

      // Solo actualizar header
      return tx.cotizacion.update({
        where: { id },
        data: {
          ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
          ...(dto.vendedorId !== undefined && { vendedorId: dto.vendedorId }),
          ...(dto.nombreCliente !== undefined && { nombreCliente: dto.nombreCliente }),
          ...(dto.documentoCliente !== undefined && { documentoCliente: dto.documentoCliente }),
          ...(dto.emailCliente !== undefined && { emailCliente: dto.emailCliente }),
          ...(dto.telefonoCliente !== undefined && { telefonoCliente: dto.telefonoCliente }),
          ...(dto.direccionCliente !== undefined && { direccionCliente: dto.direccionCliente }),
          ...(dto.moneda !== undefined && { moneda: dto.moneda }),
          ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
          ...(dto.observaciones !== undefined && { observaciones: dto.observaciones }),
          ...(dto.condiciones !== undefined && { condiciones: dto.condiciones }),
          ...(dto.fechaVencimiento !== undefined && {
            fechaVencimiento: dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null,
          }),
        },
        include: {
          detalles: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
              servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
            },
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          vendedor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });
    });
  }

  /**
   * Cambiar estado con validaciones de flujo
   */
  async updateEstado(
    id: string,
    empresaId: string,
    dto: UpdateEstadoCotizacionDto,
  ) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    this.validarTransicionEstado(cotizacion.estado, dto.estado);

    if (dto.estado === EstadoCotizacion.CONVERTIDA && !dto.comprobanteId) {
      throw new BadRequestException(
        'Se requiere comprobanteId para el estado CONVERTIDA',
      );
    }

    const updated = await this.prisma.cotizacion.update({
      where: { id },
      data: {
        estado: dto.estado,
        ...(dto.comprobanteId && { comprobanteId: dto.comprobanteId }),
      },
      include: {
        sede: { select: { id: true, nombre: true } },
        vendedor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    // Notificar cajeros cuando se aprueba (cola POS)
    if (dto.estado === EstadoCotizacion.APROBADA) {
      this.notificarCajerosNuevaCotizacion(
        empresaId,
        cotizacion.codigo,
        cotizacion.total ? Number(cotizacion.total) : 0,
      ).catch(() => {});
    }

    return updated;
  }

  /**
   * Eliminar cotizacion (solo BORRADOR)
   */
  async remove(id: string, empresaId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    if (cotizacion.estado !== EstadoCotizacion.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden eliminar cotizaciones en estado BORRADOR',
      );
    }

    await this.prisma.cotizacion.delete({
      where: { id },
    });

    return { message: 'Cotizacion eliminada exitosamente' };
  }

  /**
   * Validar compatibilidad de items del detalle
   */
  async validarCompatibilidadItems(
    empresaId: string,
    detalles: CreateCotizacionDetalleDto[],
  ) {
    const productos = detalles
      .filter((d) => d.productoId || d.varianteId)
      .map((d) => ({
        productoId: d.productoId,
        varianteId: d.varianteId,
      }));

    if (productos.length < 2) {
      return { compatible: true, conflictos: [] };
    }

    return this.compatibilidadService.validarCompatibilidad(
      empresaId,
      productos,
    );
  }

  /**
   * Duplicar cotizacion como BORRADOR
   */
  async duplicar(id: string, empresaId: string) {
    const original = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: { detalles: { orderBy: { orden: 'asc' } } },
    });

    if (!original) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      const { codigoCotizacion } =
        await this.configuracionCodigos.generarCodigoCotizacion(
          empresaId,
          original.sedeId,
          tx,
        );

      const copia = await tx.cotizacion.create({
        data: {
          empresaId,
          sedeId: original.sedeId,
          clienteId: original.clienteId,
          vendedorId: original.vendedorId,
          codigo: codigoCotizacion,
          nombre: original.nombre,
          nombreCliente: original.nombreCliente,
          documentoCliente: original.documentoCliente,
          emailCliente: original.emailCliente,
          telefonoCliente: original.telefonoCliente,
          direccionCliente: original.direccionCliente,
          moneda: original.moneda,
          tipoCambio: original.tipoCambio,
          subtotal: original.subtotal,
          descuento: original.descuento,
          impuestos: original.impuestos,
          total: original.total,
          observaciones: original.observaciones,
          condiciones: original.condiciones,
          estado: EstadoCotizacion.BORRADOR,
          detalles: {
            create: original.detalles.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              subtotal: d.subtotal,
              total: d.total,
              orden: d.orden,
            })),
          },
        },
        include: {
          detalles: {
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          vendedor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      this.logger.log(`Cotizacion duplicada: ${original.codigo} -> ${copia.codigo}`);
      return copia;
    });
  }

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

  /**
   * Calcular totales de una linea de detalle
   */
  private calcularDetalle(dto: CreateCotizacionDetalleDto, index: number) {
    const cantidad = dto.cantidad;
    const precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;
    const incluyeIgv = dto.precioIncluyeIgv ?? false;

    const subtotalBruto = cantidad * precioUnitario;

    let subtotal: number;
    let igv: number;
    let total: number;

    if (incluyeIgv) {
      // Precio ya incluye IGV → extraer base e IGV
      total = subtotalBruto - descuento;
      subtotal = total / (1 + porcentajeIGV / 100);
      igv = total - subtotal;
    } else {
      // Precio sin IGV → sumar IGV
      subtotal = subtotalBruto - descuento;
      igv = subtotal * (porcentajeIGV / 100);
      total = subtotal + igv;
    }

    // Tipo de afectación IGV (SUNAT Cat. 07)
    const tipoAfectacion = dto.tipoAfectacion || (porcentajeIGV > 0 ? '10' : '10');
    const icbperMonto = dto.icbper ?? 0;
    const totalConIcbper = total + icbperMonto;

    return {
      productoId: dto.productoId || null,
      varianteId: dto.varianteId || null,
      servicioId: dto.servicioId || null,
      descripcion: dto.descripcion,
      cantidad,
      precioUnitario,
      descuento,
      tipoAfectacion,
      porcentajeIGV,
      igv: Math.round(igv * 100) / 100,
      icbper: Math.round(icbperMonto * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(totalConIcbper * 100) / 100,
      orden: index,
    };
  }

  /**
   * Validar transicion de estado
   */
  private validarTransicionEstado(
    actual: EstadoCotizacion,
    nuevo: EstadoCotizacion,
  ) {
    const transicionesValidas: Record<EstadoCotizacion, EstadoCotizacion[]> = {
      [EstadoCotizacion.BORRADOR]: [
        EstadoCotizacion.PENDIENTE,
        EstadoCotizacion.VENCIDA,
      ],
      [EstadoCotizacion.PENDIENTE]: [
        EstadoCotizacion.APROBADA,
        EstadoCotizacion.RECHAZADA,
        EstadoCotizacion.VENCIDA,
      ],
      [EstadoCotizacion.APROBADA]: [EstadoCotizacion.CONVERTIDA],
      [EstadoCotizacion.RECHAZADA]: [],
      [EstadoCotizacion.VENCIDA]: [],
      [EstadoCotizacion.CONVERTIDA]: [],
    };

    const permitidos = transicionesValidas[actual];
    if (!permitidos || !permitidos.includes(nuevo)) {
      throw new BadRequestException(
        `No se puede cambiar de ${actual} a ${nuevo}`,
      );
    }
  }

  /**
   * Cola POS: cotizaciones pendientes y aprobadas listas para cobro
   */
  async getColaPOS(empresaId: string, sedeId?: string, userId?: string, userRole?: string) {
    const where: any = {
      empresaId,
      estado: { in: [EstadoCotizacion.PENDIENTE, EstadoCotizacion.APROBADA] },
    };
    if (sedeId) where.sedeId = sedeId;

    // Vendedor solo ve sus propias cotizaciones en la cola
    if (userRole === Rol.VENDEDOR && userId) {
      where.vendedorId = userId;
    }

    const cotizaciones = await this.prisma.cotizacion.findMany({
      where,
      orderBy: { creadoEn: 'asc' }, // Las más antiguas primero (FIFO)
      include: {
        sede: { select: { id: true, nombre: true } },
        cliente: {
          include: { persona: { select: { nombres: true, apellidos: true } } },
        },
        vendedor: {
          select: { persona: { select: { nombres: true, apellidos: true } } },
        },
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true } },
            variante: { select: { id: true, nombre: true } },
          },
        },
        _count: { select: { detalles: true } },
      },
    });

    return cotizaciones.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      estado: c.estado,
      nombreCliente: c.nombreCliente ||
        (c.cliente?.persona ? `${c.cliente.persona.nombres} ${c.cliente.persona.apellidos}` : 'Sin cliente'),
      vendedor: c.vendedor?.persona
        ? `${c.vendedor.persona.nombres} ${c.vendedor.persona.apellidos}`
        : 'Sin vendedor',
      sede: c.sede?.nombre,
      total: c.total ? Number(c.total) : 0,
      moneda: c.moneda,
      totalItems: c._count.detalles,
      detalles: c.detalles.map((d) => ({
        id: d.id,
        producto: d.producto?.nombre || d.variante?.nombre || d.descripcion,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario ? Number(d.precioUnitario) : 0,
        subtotal: d.subtotal ? Number(d.subtotal) : 0,
      })),
      creadoEn: c.creadoEn,
    }));
  }

  /**
   * Validar stock disponible para cada item de una cotización
   */
  async validarStockCotizacion(id: string, empresaId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true } },
            variante: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    const resultado = [];

    for (const detalle of cotizacion.detalles) {
      // Servicios no tienen stock
      if (!detalle.productoId && !detalle.varianteId) {
        resultado.push({
          detalleId: detalle.id,
          descripcion: detalle.descripcion,
          cantidad: Number(detalle.cantidad),
          stockDisponible: null,
          sinStock: false,
          esServicio: true,
        });
        continue;
      }

      const productoStock = await this.prisma.productoStock.findFirst({
        where: {
          sedeId: cotizacion.sedeId,
          productoId: detalle.productoId ?? null,
          varianteId: detalle.varianteId ?? null,
        },
      });

      const cantidad = Number(detalle.cantidad);
      let stockDisponible = 0;

      if (productoStock) {
        stockDisponible =
          productoStock.stockActual -
          productoStock.stockReservado -
          productoStock.stockReservadoVenta -
          productoStock.stockReservadoCombo -
          productoStock.stockDanado -
          productoStock.stockEnGarantia;
      }

      resultado.push({
        detalleId: detalle.id,
        descripcion: detalle.descripcion,
        productoNombre: detalle.producto?.nombre || detalle.variante?.nombre,
        cantidad,
        stockDisponible: Math.max(0, stockDisponible),
        sinStock: cantidad > stockDisponible,
        esServicio: false,
      });
    }

    return {
      cotizacionId: id,
      todosConStock: resultado.every((r) => !r.sinStock),
      items: resultado,
    };
  }

  /**
   * Notificar a cajeros cuando una cotización se aprueba
   */
  async notificarCajerosNuevaCotizacion(empresaId: string, cotizacionCodigo: string, total: number) {
    // Buscar usuarios con rol CAJERO en esta empresa
    const cajeros = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        rol: { in: ['CAJERO', 'EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });

    const cajeroIds = cajeros.map((c) => c.usuarioId);
    if (cajeroIds.length > 0) {
      await this.notificacionService.enviarAUsuarios(
        cajeroIds,
        `Nueva cotización ${cotizacionCodigo}`,
        `Lista para cobro - Total: S/ ${total.toFixed(2)}`,
        {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { action: 'COLA_POS', cotizacionCodigo },
        },
      );
    }
  }
}
