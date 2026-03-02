import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../../configuracion-codigos/configuracion-codigos.service';
import { OrdenCompraService } from '../orden-compra/orden-compra.service';
import {
  CreateCompraDto,
  CreateCompraDetalleDto,
  CreateCompraDesdeOcDto,
  QueryComprasDto,
} from '../dto';
import {
  EstadoCompra,
  EstadoOrdenCompra,
  EstadoLote,
  TipoMovimientoStock,
  TipoCambioPrecio,
  Prisma,
} from '@prisma/client';

@Injectable()
export class CompraService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    private readonly ordenCompraService: OrdenCompraService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CompraService.name);
  }

  /**
   * Crear compra standalone (sin OC)
   */
  async create(empresaId: string, dto: CreateCompraDto, usuarioId: string) {
    this.logger.info('Creando compra standalone', { empresaId, proveedor: dto.proveedorId });

    return this.prisma.$transaction(async (tx) => {
      const proveedor = await tx.proveedor.findFirst({
        where: { id: dto.proveedorId, empresaId },
      });

      if (!proveedor) {
        throw new NotFoundException('Proveedor no encontrado');
      }

      const codigo = await this.configuracionCodigos.generarCodigoCompra(empresaId, tx);

      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index),
      );

      const subtotal = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
      const totalDescuento = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
      const totalImpuestos = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      const compra = await tx.compra.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          proveedorId: dto.proveedorId,
          codigo,
          nombreProveedor: proveedor.nombre,
          documentoProveedor: proveedor.numeroDocumento,
          tipoDocumentoProveedor: dto.tipoDocumentoProveedor,
          serieDocumentoProveedor: dto.serieDocumentoProveedor,
          numeroDocumentoProveedor: dto.numeroDocumentoProveedor,
          terminosPago: dto.terminosPago ?? proveedor.terminosPago,
          diasCredito: dto.diasCredito ?? proveedor.diasCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          fechaRecepcion: dto.fechaRecepcion
            ? new Date(dto.fechaRecepcion)
            : new Date(),
          observaciones: dto.observaciones,
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
              orden: d.orden,
            })),
          },
        },
        include: this.getInclude(),
      });

      this.logger.log(`Compra creada: ${compra.codigo}`);
      return compra;
    });
  }

  /**
   * Crear compra desde una Orden de Compra
   */
  async createDesdeOrdenCompra(
    empresaId: string,
    dto: CreateCompraDesdeOcDto,
    usuarioId: string,
  ) {
    this.logger.info('Creando compra desde OC', { empresaId, oc: dto.ordenCompraId });

    return this.prisma.$transaction(async (tx) => {
      // Validar OC
      const oc = await tx.ordenCompra.findFirst({
        where: { id: dto.ordenCompraId, empresaId },
        include: {
          detalles: true,
          proveedor: true,
        },
      });

      if (!oc) {
        throw new NotFoundException('Orden de compra no encontrada');
      }

      if (
        oc.estado !== EstadoOrdenCompra.APROBADA &&
        oc.estado !== EstadoOrdenCompra.PARCIAL
      ) {
        throw new BadRequestException(
          'La OC debe estar APROBADA o PARCIAL para crear una recepción',
        );
      }

      // Validar cada línea
      const detallesData: Array<{
        ordenCompraDetalleId: string;
        productoId: string | null;
        varianteId: string | null;
        descripcion: string;
        cantidad: number;
        precioUnitario: number;
        descuento: number;
        porcentajeIGV: number;
        igv: number;
        subtotal: number;
        total: number;
        orden: number;
      }> = [];

      for (const [index, linea] of dto.lineas.entries()) {
        const detalleOc = oc.detalles.find(
          (d) => d.id === linea.ordenCompraDetalleId,
        );

        if (!detalleOc) {
          throw new BadRequestException(
            `Detalle de OC ${linea.ordenCompraDetalleId} no encontrado`,
          );
        }

        if (linea.cantidad > detalleOc.cantidadPendiente) {
          throw new BadRequestException(
            `Cantidad ${linea.cantidad} excede la pendiente ${detalleOc.cantidadPendiente} para "${detalleOc.descripcion}"`,
          );
        }

        const precioUnitario = linea.precioUnitario ?? Number(detalleOc.precioUnitario);
        const descuento = Number(detalleOc.descuento);
        const porcentajeIGV = Number(detalleOc.porcentajeIGV);

        const subtotalBruto = linea.cantidad * precioUnitario;
        const subtotal = subtotalBruto - descuento;
        const igv = subtotal * (porcentajeIGV / 100);
        const total = subtotal + igv;

        detallesData.push({
          ordenCompraDetalleId: linea.ordenCompraDetalleId,
          productoId: detalleOc.productoId,
          varianteId: detalleOc.varianteId,
          descripcion: detalleOc.descripcion,
          cantidad: linea.cantidad,
          precioUnitario,
          descuento,
          porcentajeIGV,
          igv: Math.round(igv * 100) / 100,
          subtotal: Math.round(subtotal * 100) / 100,
          total: Math.round(total * 100) / 100,
          orden: index,
        });
      }

      const subtotal = detallesData.reduce((sum, d) => sum + d.subtotal, 0);
      const totalDescuento = detallesData.reduce((sum, d) => sum + d.descuento, 0);
      const totalImpuestos = detallesData.reduce((sum, d) => sum + d.igv, 0);
      const total = detallesData.reduce((sum, d) => sum + d.total, 0);

      const codigo = await this.configuracionCodigos.generarCodigoCompra(empresaId, tx);

      const compra = await tx.compra.create({
        data: {
          empresaId,
          sedeId: oc.sedeId,
          proveedorId: oc.proveedorId,
          ordenCompraId: oc.id,
          codigo,
          nombreProveedor: oc.nombreProveedor,
          documentoProveedor: oc.documentoProveedor,
          tipoDocumentoProveedor: dto.tipoDocumentoProveedor,
          serieDocumentoProveedor: dto.serieDocumentoProveedor,
          numeroDocumentoProveedor: dto.numeroDocumentoProveedor,
          terminosPago: dto.terminosPago ?? oc.terminosPago,
          diasCredito: dto.diasCredito ?? oc.diasCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          moneda: dto.moneda ?? oc.moneda,
          tipoCambio: dto.tipoCambio ?? oc.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          observaciones: dto.observaciones,
          creadoPor: usuarioId,
          detalles: {
            create: detallesData.map((d) => ({
              ordenCompraDetalleId: d.ordenCompraDetalleId,
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
              orden: d.orden,
            })),
          },
        },
        include: this.getInclude(),
      });

      this.logger.log(`Compra desde OC creada: ${compra.codigo} (OC: ${oc.codigo})`);
      return compra;
    });
  }

  /**
   * CONFIRMAR COMPRA - LA TRANSACCIÓN CRÍTICA
   * Actualiza stock, crea lotes, registra movimientos
   */
  async confirmar(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Confirmando compra', { id, empresaId });

    return this.prisma.$transaction(async (tx) => {
      // 1. Validar compra
      const compra = await tx.compra.findFirst({
        where: { id, empresaId },
        include: {
          detalles: true,
          proveedor: true,
        },
      });

      if (!compra) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (compra.estado !== EstadoCompra.BORRADOR) {
        throw new BadRequestException(
          'Solo se puede confirmar una compra en estado BORRADOR',
        );
      }

      // 2. Procesar cada detalle
      for (const detalle of compra.detalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue; // Items sin producto asociado (servicios/otros)
        }

        // a. SELECT FOR UPDATE en ProductoStock (o crear si no existe)
        let productoStock = await this.findOrCreateProductoStock(
          tx,
          empresaId,
          compra.sedeId,
          detalle.productoId,
          detalle.varianteId,
        );

        const [stockLocked] = await tx.$queryRaw<
          Array<{
            id: string;
            stockActual: number;
            precioCosto: string | null;
            sedeId: string;
          }>
        >`SELECT id, "stockActual", CAST("precioCosto" AS TEXT) as "precioCosto", "sedeId"
          FROM "ProductoStock"
          WHERE id = ${productoStock.id}
          FOR UPDATE`;

        if (!stockLocked) {
          throw new NotFoundException(
            `ProductoStock no encontrado para el detalle "${detalle.descripcion}"`,
          );
        }

        const stockAnterior = stockLocked.stockActual;
        const costoAnterior = stockLocked.precioCosto
          ? parseFloat(stockLocked.precioCosto)
          : 0;
        const precioCompra = Number(detalle.precioUnitario);

        // b. Calcular costo promedio ponderado
        let nuevoCosto: number;
        if (stockAnterior === 0) {
          nuevoCosto = precioCompra;
        } else {
          nuevoCosto =
            (stockAnterior * costoAnterior + detalle.cantidad * precioCompra) /
            (stockAnterior + detalle.cantidad);
        }
        nuevoCosto = Math.round(nuevoCosto * 100) / 100;

        const nuevoStock = stockAnterior + detalle.cantidad;

        // c. Actualizar ProductoStock
        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: {
            stockActual: nuevoStock,
            precioCosto: nuevoCosto,
          },
        });

        // d. Crear MovimientoStock
        await tx.movimientoStock.create({
          data: {
            sedeId: compra.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.ENTRADA_COMPRA,
            tipoDocumento: 'COMPRA',
            numeroDocumento: compra.codigo,
            cantidadAnterior: stockAnterior,
            cantidad: detalle.cantidad,
            cantidadNueva: nuevoStock,
            motivo: `Compra ${compra.codigo} - ${detalle.descripcion}`,
            compraId: compra.id,
            usuarioId,
          },
        });

        // e. Crear Lote
        const codigoLote = await this.configuracionCodigos.generarCodigoLote(
          empresaId,
          tx,
        );

        const lote = await tx.lote.create({
          data: {
            empresaId,
            sedeId: compra.sedeId,
            productoStockId: productoStock.id,
            productoId: detalle.productoId,
            varianteId: detalle.varianteId,
            compraId: compra.id,
            codigo: codigoLote,
            precioCosto: precioCompra,
            moneda: compra.moneda,
            cantidadInicial: detalle.cantidad,
            cantidadActual: detalle.cantidad,
            proveedorId: compra.proveedorId,
            nombreProveedor: compra.nombreProveedor,
            creadoPor: usuarioId,
          },
        });

        // f. Vincular detalle al lote
        await tx.compraDetalle.update({
          where: { id: detalle.id },
          data: { loteId: lote.id },
        });

        // g. Registrar historial de precio de costo por sede
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: productoStock.id,
            sedeId: compra.sedeId,
            precioCostoAnterior: costoAnterior > 0 ? costoAnterior : null,
            precioCostoNuevo: nuevoCosto,
            tipoCambio: TipoCambioPrecio.COSTO,
            razon: `Compra ${compra.codigo}`,
            origenModulo: 'COMPRA',
            usuarioId,
          },
        });

        // h. Actualizar cantidadRecibida en OrdenCompraDetalle si aplica
        if (detalle.ordenCompraDetalleId) {
          await tx.ordenCompraDetalle.update({
            where: { id: detalle.ordenCompraDetalleId },
            data: {
              cantidadRecibida: { increment: detalle.cantidad },
              cantidadPendiente: { decrement: detalle.cantidad },
            },
          });
        }

        this.logger.log(
          `Stock actualizado: ${detalle.descripcion} | +${detalle.cantidad} | Costo: ${costoAnterior} -> ${nuevoCosto} | Lote: ${codigoLote}`,
        );
      }

      // 3. Si tiene OC, actualizar su estado
      if (compra.ordenCompraId) {
        await this.ordenCompraService.actualizarEstadoPorRecepcion(
          compra.ordenCompraId,
          tx,
        );
      }

      // 4. Actualizar compra a CONFIRMADA
      const compraConfirmada = await tx.compra.update({
        where: { id },
        data: {
          estado: EstadoCompra.CONFIRMADA,
          confirmadoPor: usuarioId,
          confirmadoEn: new Date(),
        },
        include: this.getInclude(),
      });

      this.logger.log(`Compra confirmada: ${compra.codigo}`);
      return compraConfirmada;
    });
  }

  /**
   * ANULAR COMPRA - Reversa stock
   */
  async anular(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Anulando compra', { id, empresaId });

    return this.prisma.$transaction(async (tx) => {
      const compra = await tx.compra.findFirst({
        where: { id, empresaId },
        include: {
          detalles: { include: { lote: true } },
        },
      });

      if (!compra) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (compra.estado !== EstadoCompra.CONFIRMADA) {
        throw new BadRequestException(
          'Solo se puede anular una compra CONFIRMADA',
        );
      }

      for (const detalle of compra.detalles) {
        if (!detalle.productoId && !detalle.varianteId) continue;

        // SELECT FOR UPDATE
        const productoStock = await this.findProductoStock(
          tx,
          empresaId,
          compra.sedeId,
          detalle.productoId,
          detalle.varianteId,
        );

        if (!productoStock) continue;

        const [stockLocked] = await tx.$queryRaw<
          Array<{ id: string; stockActual: number; precioCosto: string | null }>
        >`SELECT id, "stockActual", CAST("precioCosto" AS TEXT) as "precioCosto"
          FROM "ProductoStock"
          WHERE id = ${productoStock.id}
          FOR UPDATE`;

        if (!stockLocked) continue;

        const stockAnterior = stockLocked.stockActual;
        const nuevoStock = Math.max(0, stockAnterior - detalle.cantidad);

        // Recalcular costo promedio sin este lote
        const costoAnterior = stockLocked.precioCosto
          ? parseFloat(stockLocked.precioCosto)
          : 0;
        let nuevoCosto = costoAnterior;
        if (nuevoStock > 0 && stockAnterior > 0) {
          const precioCompra = Number(detalle.precioUnitario);
          nuevoCosto =
            (stockAnterior * costoAnterior - detalle.cantidad * precioCompra) /
            nuevoStock;
          nuevoCosto = Math.max(0, Math.round(nuevoCosto * 100) / 100);
        } else if (nuevoStock === 0) {
          nuevoCosto = 0;
        }

        // Actualizar stock
        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: {
            stockActual: nuevoStock,
            precioCosto: nuevoCosto,
          },
        });

        // Movimiento de salida
        await tx.movimientoStock.create({
          data: {
            sedeId: compra.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.SALIDA_DEVOLUCION_PROVEEDOR,
            tipoDocumento: 'ANULACION_COMPRA',
            numeroDocumento: compra.codigo,
            cantidadAnterior: stockAnterior,
            cantidad: -detalle.cantidad,
            cantidadNueva: nuevoStock,
            motivo: `Anulación compra ${compra.codigo}`,
            compraId: compra.id,
            usuarioId,
          },
        });

        // Marcar lote como AGOTADO
        if (detalle.lote) {
          await tx.lote.update({
            where: { id: detalle.lote.id },
            data: {
              cantidadActual: 0,
              estado: EstadoLote.AGOTADO,
            },
          });
        }

        // Revertir cantidadRecibida en OC si aplica
        if (detalle.ordenCompraDetalleId) {
          await tx.ordenCompraDetalle.update({
            where: { id: detalle.ordenCompraDetalleId },
            data: {
              cantidadRecibida: { decrement: detalle.cantidad },
              cantidadPendiente: { increment: detalle.cantidad },
            },
          });
        }
      }

      // Actualizar estado de OC si aplica
      if (compra.ordenCompraId) {
        await this.ordenCompraService.actualizarEstadoPorRecepcion(
          compra.ordenCompraId,
          tx,
        );
      }

      const compraAnulada = await tx.compra.update({
        where: { id },
        data: {
          estado: EstadoCompra.ANULADA,
          actualizadoPor: usuarioId,
        },
        include: this.getInclude(),
      });

      this.logger.log(`Compra anulada: ${compra.codigo}`);
      return compraAnulada;
    });
  }

  /**
   * Listar compras con filtros
   */
  async findAll(empresaId: string, filtros?: QueryComprasDto) {
    const where: Prisma.CompraWhereInput = { empresaId };

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;
    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.ordenCompraId) where.ordenCompraId = filtros.ordenCompraId;

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.creadoEn = {};
      if (filtros.fechaDesde) where.creadoEn.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) where.creadoEn.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.compra.findMany({
        where,
        include: {
          sede: { select: { id: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true, codigo: true } },
          ordenCompra: { select: { id: true, codigo: true } },
          _count: { select: { detalles: true, lotes: true } },
        },
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.compra.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Obtener detalle de una compra
   */
  async findOne(id: string, empresaId: string) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId },
      include: this.getInclude(),
    });

    if (!compra) {
      throw new NotFoundException('Compra no encontrada');
    }

    return compra;
  }

  /**
   * Actualizar compra (solo BORRADOR)
   */
  async update(
    id: string,
    empresaId: string,
    dto: Partial<CreateCompraDto>,
    usuarioId: string,
  ) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId },
    });

    if (!compra) {
      throw new NotFoundException('Compra no encontrada');
    }

    if (compra.estado !== EstadoCompra.BORRADOR) {
      throw new BadRequestException(
        'Solo se puede editar una compra en estado BORRADOR',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let montosData = {};
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.compraDetalle.deleteMany({ where: { compraId: id } });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        await tx.compraDetalle.createMany({
          data: detallesCalculados.map((d) => ({
            compraId: id,
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
            orden: d.orden,
          })),
        });

        const subtotal = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
        const totalDescuento = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
        const totalImpuestos = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
        const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);
        montosData = { subtotal, descuento: totalDescuento, impuestos: totalImpuestos, total };
      }

      return tx.compra.update({
        where: { id },
        data: {
          ...montosData,
          tipoDocumentoProveedor: dto.tipoDocumentoProveedor ?? compra.tipoDocumentoProveedor,
          serieDocumentoProveedor: dto.serieDocumentoProveedor ?? compra.serieDocumentoProveedor,
          numeroDocumentoProveedor: dto.numeroDocumentoProveedor ?? compra.numeroDocumentoProveedor,
          terminosPago: dto.terminosPago ?? compra.terminosPago,
          diasCredito: dto.diasCredito ?? compra.diasCredito,
          moneda: dto.moneda ?? compra.moneda,
          tipoCambio: dto.tipoCambio ?? compra.tipoCambio,
          observaciones: dto.observaciones ?? compra.observaciones,
          actualizadoPor: usuarioId,
        },
        include: this.getInclude(),
      });
    });
  }

  /**
   * Eliminar compra (solo BORRADOR)
   */
  async remove(id: string, empresaId: string) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId },
    });

    if (!compra) {
      throw new NotFoundException('Compra no encontrada');
    }

    if (compra.estado !== EstadoCompra.BORRADOR) {
      throw new BadRequestException(
        'Solo se puede eliminar una compra en estado BORRADOR',
      );
    }

    await this.prisma.compra.delete({ where: { id } });
    return { message: 'Compra eliminada' };
  }

  // ========== HELPERS PRIVADOS ==========

  /**
   * Buscar o crear ProductoStock para una sede
   */
  private async findOrCreateProductoStock(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId: string,
    productoId: string | null,
    varianteId: string | null,
  ) {
    let stock = await tx.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
    });

    if (!stock) {
      stock = await tx.productoStock.create({
        data: {
          sedeId,
          empresaId,
          productoId: productoId || null,
          varianteId: varianteId || null,
          stockActual: 0,
          precioCosto: 0,
        },
      });
      this.logger.log(
        `ProductoStock creado automáticamente para sede=${sedeId}, producto=${productoId}, variante=${varianteId}`,
      );
    }

    return stock;
  }

  /**
   * Buscar ProductoStock existente
   */
  private async findProductoStock(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId: string,
    productoId: string | null,
    varianteId: string | null,
  ) {
    return tx.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
    });
  }

  /**
   * Calcular montos de un detalle
   */
  private calcularDetalle(dto: CreateCompraDetalleDto, index: number) {
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
      ordenCompraDetalleId: dto.ordenCompraDetalleId || null,
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
          lote: { select: { id: true, codigo: true, precioCosto: true } },
          ordenCompraDetalle: {
            select: { id: true, descripcion: true, cantidad: true },
          },
        },
        orderBy: { orden: 'asc' as const },
      },
      sede: { select: { id: true, nombre: true } },
      proveedor: { select: { id: true, nombre: true, codigo: true } },
      ordenCompra: { select: { id: true, codigo: true, estado: true } },
      lotes: {
        select: { id: true, codigo: true, precioCosto: true, cantidadActual: true, estado: true },
      },
    };
  }
}
