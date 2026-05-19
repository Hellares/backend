import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../../configuracion-codigos/configuracion-codigos.service';
import { createCursorPaginatedResponse } from '../../common/utils/pagination.util';
import { OrdenCompraService } from '../orden-compra/orden-compra.service';
import {
  CreateCompraDto,
  CreateCompraDetalleDto,
  CreateCompraDesdeOcDto,
  DistribuirCompraDto,
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
    private readonly cacheService: CacheService,
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

    const factoresMap = await this._resolverFactoresCompra(
      empresaId,
      dto.detalles,
    );

    return this.prisma.$transaction(async (tx) => {
      const proveedor = await tx.proveedor.findFirst({
        where: { id: dto.proveedorId, empresaId },
      });

      if (!proveedor) {
        throw new NotFoundException('Proveedor no encontrado');
      }

      const codigo = await this.configuracionCodigos.generarCodigoCompra(empresaId, tx);

      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index, factoresMap),
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
              usaUnidadCompra: d.usaUnidadCompra,
              cantidadOriginal: d.cantidadOriginal,
              unidadOriginalSimbolo: d.unidadOriginalSimbolo,
              factorAplicado: d.factorAplicado,
              nuevoPrecioVenta: d.nuevoPrecioVenta,
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
        usaUnidadCompra: boolean;
        cantidadOriginal: number | null;
        unidadOriginalSimbolo: string | null;
        factorAplicado: number | null;
        nuevoPrecioVenta: number | null;
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

        // Propagar snapshot de unidad de compra desde OC a Compra.
        // Si la recepción es parcial, ajustamos cantidadOriginal por
        // proporción para mantener consistencia (X atómicos / factor).
        const ocUsaUC = detalleOc.usaUnidadCompra;
        const ocFactor = detalleOc.factorAplicado
          ? Number(detalleOc.factorAplicado)
          : null;
        const cantidadOriginal =
          ocUsaUC && ocFactor && ocFactor > 0
            ? +(linea.cantidad / ocFactor).toFixed(4)
            : null;

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
          usaUnidadCompra: ocUsaUC,
          cantidadOriginal,
          unidadOriginalSimbolo: detalleOc.unidadOriginalSimbolo,
          factorAplicado: ocFactor,
          nuevoPrecioVenta: linea.nuevoPrecioVenta ?? null,
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
              usaUnidadCompra: d.usaUnidadCompra,
              cantidadOriginal: d.cantidadOriginal,
              unidadOriginalSimbolo: d.unidadOriginalSimbolo,
              factorAplicado: d.factorAplicado,
              nuevoPrecioVenta: d.nuevoPrecioVenta,
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

    const result = await this.prisma.$transaction(async (tx) => {
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

      // 2. Validar que los productos estén activos (batch fetch para evitar N+1)
      const productoIds = [...new Set(compra.detalles.map(d => d.productoId).filter(Boolean))] as string[];
      const varianteIds = [...new Set(compra.detalles.map(d => d.varianteId).filter(Boolean))] as string[];

      const [productos, variantes] = await Promise.all([
        productoIds.length > 0
          ? tx.producto.findMany({
              where: { id: { in: productoIds } },
              select: { id: true, nombre: true, isActive: true, deletedAt: true },
            })
          : [],
        varianteIds.length > 0
          ? tx.productoVariante.findMany({
              where: { id: { in: varianteIds } },
              select: { id: true, nombre: true, isActive: true, deletedAt: true },
            })
          : [],
      ]);

      for (const producto of productos) {
        if (!producto.isActive || producto.deletedAt) {
          throw new BadRequestException(
            `El producto "${producto.nombre}" está inactivo o eliminado`,
          );
        }
      }
      for (const variante of variantes) {
        if (!variante.isActive || variante.deletedAt) {
          throw new BadRequestException(
            `La variante "${variante.nombre}" está inactiva o eliminada`,
          );
        }
      }

      // 3. Procesar cada detalle
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

        // Si la línea trae un nuevo precio de venta, lo aplicamos
        // dentro del mismo update del ProductoStock + registramos
        // en ProductoPrecioHistorialSede para auditoría.
        const nuevoPrecioVenta =
          detalle.nuevoPrecioVenta != null
            ? Number(detalle.nuevoPrecioVenta)
            : null;
        const aplicarNuevoPrecio = nuevoPrecioVenta != null;

        // Cargar precio anterior antes de pisarlo (solo si vamos a
        // cambiarlo, para no pegar query extra cuando no aplica).
        let precioVentaAnterior: number | null = null;
        if (aplicarNuevoPrecio) {
          const stockConPrecio = await tx.productoStock.findUnique({
            where: { id: productoStock.id },
            select: { precio: true },
          });
          precioVentaAnterior =
            stockConPrecio?.precio != null
              ? Number(stockConPrecio.precio)
              : null;
        }

        // c. Actualizar ProductoStock (stock + costo + opcional precio venta)
        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: {
            stockActual: nuevoStock,
            precioCosto: nuevoCosto,
            ...(aplicarNuevoPrecio
              ? {
                  precio: nuevoPrecioVenta,
                  // Si el producto no tenía precio configurado todavía,
                  // marcarlo como configurado al setearle uno desde compra.
                  precioConfigurado: true,
                }
              : {}),
          },
        });

        // c.1 Registrar cambio de precio venta en historial (solo si cambió).
        if (
          aplicarNuevoPrecio &&
          nuevoPrecioVenta !== precioVentaAnterior
        ) {
          await tx.productoPrecioHistorialSede.create({
            data: {
              productoStockId: productoStock.id,
              sedeId: compra.sedeId,
              tipoCambio: 'MANUAL',
              precioAnterior:
                precioVentaAnterior != null
                  ? new Prisma.Decimal(precioVentaAnterior)
                  : null,
              precioNuevo: new Prisma.Decimal(nuevoPrecioVenta!),
              razon: `Ajuste en compra ${compra.codigo}`,
              origenModulo: 'COMPRA',
              usuarioId,
            },
          });
        }

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

      // 4. Si tiene OC, actualizar su estado
      if (compra.ordenCompraId) {
        await this.ordenCompraService.actualizarEstadoPorRecepcion(
          compra.ordenCompraId,
          tx,
        );
      }

      // 5. Actualizar compra a CONFIRMADA
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

    // Invalidar cache de productos después de incrementar stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * ANULAR COMPRA - Reversa stock
   * Valida que los lotes no hayan sido consumidos parcialmente antes de reversar
   */
  async anular(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Anulando compra', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
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

      // BUG 4 FIX: Validar que ningún lote haya sido consumido parcialmente
      for (const detalle of compra.detalles) {
        if (!detalle.lote) continue;
        if (detalle.lote.cantidadActual < detalle.lote.cantidadInicial) {
          throw new BadRequestException(
            `No se puede anular: el lote ${detalle.lote.codigo} ya fue parcialmente consumido ` +
            `(${detalle.lote.cantidadInicial - detalle.lote.cantidadActual} unidades vendidas/consumidas). ` +
            `Cantidad inicial: ${detalle.lote.cantidadInicial}, cantidad actual: ${detalle.lote.cantidadActual}`,
          );
        }
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
        const costoAnterior = stockLocked.precioCosto
          ? parseFloat(stockLocked.precioCosto)
          : 0;
        const precioCompra = Number(detalle.precioUnitario);

        // BUG 1 FIX: Usar cantidadActual del lote (lo que realmente queda) en vez de detalle.cantidad
        const cantidadAReversar = detalle.lote
          ? detalle.lote.cantidadActual
          : detalle.cantidad;

        const nuevoStock = Math.max(0, stockAnterior - cantidadAReversar);

        // Recalcular costo promedio sin este lote
        let nuevoCosto = costoAnterior;
        if (nuevoStock > 0 && stockAnterior > 0) {
          nuevoCosto =
            (stockAnterior * costoAnterior - cantidadAReversar * precioCompra) /
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

        // ISSUE 7 FIX: Usar cantidadAReversar para mantener aritmética consistente
        // cantidadAnterior + cantidad === cantidadNueva
        await tx.movimientoStock.create({
          data: {
            sedeId: compra.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.SALIDA_DEVOLUCION_PROVEEDOR,
            tipoDocumento: 'ANULACION_COMPRA',
            numeroDocumento: compra.codigo,
            cantidadAnterior: stockAnterior,
            cantidad: -cantidadAReversar,
            cantidadNueva: nuevoStock,
            motivo: `Anulación compra ${compra.codigo}`,
            compraId: compra.id,
            usuarioId,
          },
        });

        // BUG 2 FIX: Registrar historial de precio de costo por sede en anulación
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: productoStock.id,
            sedeId: compra.sedeId,
            precioCostoAnterior: costoAnterior > 0 ? costoAnterior : null,
            precioCostoNuevo: nuevoCosto,
            tipoCambio: TipoCambioPrecio.COSTO,
            razon: `Anulación compra ${compra.codigo}`,
            origenModulo: 'COMPRA',
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

        this.logger.log(
          `Stock revertido: ${detalle.descripcion} | -${cantidadAReversar} | Costo: ${costoAnterior} -> ${nuevoCosto}`,
        );
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

    // Invalidar cache de productos después de revertir stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * DISTRIBUIR COMPRA A MÚLTIPLES SEDES
   * Transfiere stock de la sede origen a sedes destino de forma atómica
   */
  async distribuir(
    id: string,
    empresaId: string,
    dto: DistribuirCompraDto,
    usuarioId: string,
  ) {
    this.logger.info('Distribuyendo compra a sedes', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Validar compra es CONFIRMADA
      const compra = await tx.compra.findFirst({
        where: { id, empresaId },
        include: {
          detalles: { include: { lote: true } },
          sede: { select: { id: true, nombre: true } },
        },
      });

      if (!compra) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (compra.estado !== EstadoCompra.CONFIRMADA) {
        throw new BadRequestException(
          'Solo se puede distribuir una compra CONFIRMADA',
        );
      }

      // 2. Recopilar sedes destino únicas y validarlas
      const sedesDestinoIds = new Set<string>();
      for (const item of dto.items) {
        for (const dist of item.distribuciones) {
          sedesDestinoIds.add(dist.sedeDestinoId);
        }
      }

      // Validar que ninguna sede destino sea la sede origen
      for (const sedeDestinoId of sedesDestinoIds) {
        if (sedeDestinoId === compra.sedeId) {
          throw new BadRequestException(
            'La sede destino no puede ser la misma sede origen de la compra',
          );
        }
      }

      // Batch fetch sedes destino (evita N+1)
      const sedesDestino = await tx.sede.findMany({
        where: {
          id: { in: Array.from(sedesDestinoIds) },
          empresaId,
          isActive: true,
        },
        select: { id: true, nombre: true },
      });

      const sedesDestinoMap = new Map(sedesDestino.map(s => [s.id, s]));
      for (const sedeDestinoId of sedesDestinoIds) {
        if (!sedesDestinoMap.has(sedeDestinoId)) {
          throw new NotFoundException(
            `Sede destino ${sedeDestinoId} no encontrada o inactiva`,
          );
        }
      }

      // 3. Validar detalles y cantidades (sin locks aún)
      type ItemValidado = {
        detalle: (typeof compra.detalles)[0];
        totalDistribuir: number;
        distribuciones: Array<{ sedeDestinoId: string; cantidad: number }>;
      };
      const itemsValidados: ItemValidado[] = [];

      for (const item of dto.items) {
        const detalle = compra.detalles.find((d) => d.id === item.compraDetalleId);

        if (!detalle) {
          throw new BadRequestException(
            `Detalle de compra ${item.compraDetalleId} no encontrado`,
          );
        }

        if (!detalle.productoId && !detalle.varianteId) {
          throw new BadRequestException(
            `El detalle "${detalle.descripcion}" no tiene producto asociado`,
          );
        }

        if (!detalle.lote) {
          throw new BadRequestException(
            `El detalle "${detalle.descripcion}" no tiene lote asignado`,
          );
        }

        const totalDistribuir = item.distribuciones.reduce(
          (sum, d) => sum + d.cantidad,
          0,
        );

        if (totalDistribuir > detalle.lote.cantidadActual) {
          throw new BadRequestException(
            `La cantidad a distribuir (${totalDistribuir}) excede el stock disponible ` +
            `(${detalle.lote.cantidadActual}) del lote ${detalle.lote.codigo} para "${detalle.descripcion}"`,
          );
        }

        itemsValidados.push({ detalle, totalDistribuir, distribuciones: item.distribuciones });
      }

      // 4. Resolver TODOS los ProductoStock IDs (origen + destino) antes de lockear
      const productoStockMap = new Map<string, { id: string; sedeId: string; tipo: 'origen' | 'destino' }>();

      for (const item of itemsValidados) {
        // Resolver origen
        const psOrigen = await this.findProductoStock(
          tx, empresaId, compra.sedeId, item.detalle.productoId, item.detalle.varianteId,
        );
        if (!psOrigen) {
          throw new NotFoundException(
            `ProductoStock origen no encontrado para "${item.detalle.descripcion}"`,
          );
        }
        productoStockMap.set(psOrigen.id, { id: psOrigen.id, sedeId: compra.sedeId, tipo: 'origen' });

        // Resolver destinos (findOrCreate para que existan antes del lock)
        for (const dist of item.distribuciones) {
          const psDestino = await this.findOrCreateProductoStock(
            tx, empresaId, dist.sedeDestinoId, item.detalle.productoId, item.detalle.varianteId,
          );
          productoStockMap.set(psDestino.id, { id: psDestino.id, sedeId: dist.sedeDestinoId, tipo: 'destino' });
        }
      }

      // 5. Adquirir locks en orden consistente (por ID ASC) para prevenir deadlocks
      const allPsIds = Array.from(productoStockMap.keys()).sort();
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; stockActual: number; precioCosto: string | null }>
      >`SELECT id, "stockActual", CAST("precioCosto" AS TEXT) as "precioCosto"
        FROM "ProductoStock"
        WHERE id = ANY(${allPsIds}::text[])
        ORDER BY id
        FOR UPDATE`;

      const lockedMap = new Map(lockedRows.map(r => [r.id, r]));

      // 6. Procesar cada ítem con los locks ya adquiridos
      for (const item of itemsValidados) {
        const { detalle, totalDistribuir } = item;

        // 6a. Restar stock en sede origen
        const psOrigen = await this.findProductoStock(
          tx, empresaId, compra.sedeId, detalle.productoId, detalle.varianteId,
        );
        const stockOrigenLocked = lockedMap.get(psOrigen!.id);

        if (!stockOrigenLocked) {
          throw new NotFoundException(
            `ProductoStock origen bloqueado no encontrado para "${detalle.descripcion}"`,
          );
        }

        const stockOrigenAnterior = stockOrigenLocked.stockActual;
        const precioCostoLote = Number(detalle.lote!.precioCosto);
        const nuevoStockOrigen = stockOrigenAnterior - totalDistribuir;

        if (nuevoStockOrigen < 0) {
          throw new BadRequestException(
            `Stock insuficiente en sede origen para "${detalle.descripcion}". ` +
            `Disponible: ${stockOrigenAnterior}, requerido: ${totalDistribuir}`,
          );
        }

        await tx.productoStock.update({
          where: { id: psOrigen!.id },
          data: { stockActual: nuevoStockOrigen },
        });

        // Movimiento SALIDA en origen
        await tx.movimientoStock.create({
          data: {
            sedeId: compra.sedeId,
            empresaId,
            productoStockId: psOrigen!.id,
            tipo: TipoMovimientoStock.SALIDA_TRANSFERENCIA,
            tipoDocumento: 'DISTRIBUCION_COMPRA',
            numeroDocumento: compra.codigo,
            cantidadAnterior: stockOrigenAnterior,
            cantidad: -totalDistribuir,
            cantidadNueva: nuevoStockOrigen,
            motivo: `Distribución compra ${compra.codigo} - ${detalle.descripcion}` +
              (dto.observaciones ? ` | ${dto.observaciones}` : ''),
            compraId: compra.id,
            usuarioId,
          },
        });

        // Actualizar lote origen
        const nuevaCantidadLote = detalle.lote!.cantidadActual - totalDistribuir;
        await tx.lote.update({
          where: { id: detalle.lote!.id },
          data: {
            cantidadActual: nuevaCantidadLote,
            estado: nuevaCantidadLote === 0 ? EstadoLote.AGOTADO : EstadoLote.ACTIVO,
          },
        });

        // 6b. Por cada sede destino
        for (const dist of item.distribuciones) {
          const psDestino = await this.findOrCreateProductoStock(
            tx, empresaId, dist.sedeDestinoId, detalle.productoId, detalle.varianteId,
          );

          const stockDestinoLocked = lockedMap.get(psDestino.id);
          const stockDestinoAnterior = stockDestinoLocked?.stockActual ?? 0;
          const costoDestinoAnterior = stockDestinoLocked?.precioCosto
            ? parseFloat(stockDestinoLocked.precioCosto)
            : 0;

          // Calcular costo promedio ponderado en destino
          let nuevoCostoDestino: number;
          if (stockDestinoAnterior === 0) {
            nuevoCostoDestino = precioCostoLote;
          } else {
            nuevoCostoDestino =
              (stockDestinoAnterior * costoDestinoAnterior +
                dist.cantidad * precioCostoLote) /
              (stockDestinoAnterior + dist.cantidad);
          }
          nuevoCostoDestino = Math.round(nuevoCostoDestino * 100) / 100;

          const nuevoStockDestino = stockDestinoAnterior + dist.cantidad;

          await tx.productoStock.update({
            where: { id: psDestino.id },
            data: {
              stockActual: nuevoStockDestino,
              precioCosto: nuevoCostoDestino,
            },
          });

          // Movimiento ENTRADA en destino
          await tx.movimientoStock.create({
            data: {
              sedeId: dist.sedeDestinoId,
              empresaId,
              productoStockId: psDestino.id,
              tipo: TipoMovimientoStock.ENTRADA_TRANSFERENCIA,
              tipoDocumento: 'DISTRIBUCION_COMPRA',
              numeroDocumento: compra.codigo,
              cantidadAnterior: stockDestinoAnterior,
              cantidad: dist.cantidad,
              cantidadNueva: nuevoStockDestino,
              motivo: `Distribución compra ${compra.codigo} - ${detalle.descripcion}` +
                (dto.observaciones ? ` | ${dto.observaciones}` : ''),
              compraId: compra.id,
              usuarioId,
            },
          });

          // Crear lote en sede destino
          const codigoLoteDestino = await this.configuracionCodigos.generarCodigoLote(
            empresaId,
            tx,
          );

          await tx.lote.create({
            data: {
              empresaId,
              sedeId: dist.sedeDestinoId,
              productoStockId: psDestino.id,
              productoId: detalle.productoId,
              varianteId: detalle.varianteId,
              compraId: compra.id,
              codigo: codigoLoteDestino,
              precioCosto: precioCostoLote,
              moneda: compra.moneda,
              cantidadInicial: dist.cantidad,
              cantidadActual: dist.cantidad,
              proveedorId: compra.proveedorId,
              nombreProveedor: compra.nombreProveedor,
              observaciones: `Distribución desde ${compra.sede.nombre} - Compra ${compra.codigo}`,
              creadoPor: usuarioId,
            },
          });

          // Registrar historial de precio si el costo cambió
          if (costoDestinoAnterior !== nuevoCostoDestino) {
            await tx.productoPrecioHistorialSede.create({
              data: {
                productoStockId: psDestino.id,
                sedeId: dist.sedeDestinoId,
                precioCostoAnterior: costoDestinoAnterior > 0 ? costoDestinoAnterior : null,
                precioCostoNuevo: nuevoCostoDestino,
                tipoCambio: TipoCambioPrecio.COSTO,
                razon: `Distribución compra ${compra.codigo}`,
                origenModulo: 'COMPRA',
                usuarioId,
              },
            });
          }

          this.logger.log(
            `Distribución: ${detalle.descripcion} | ${dist.cantidad} unids -> sede ${dist.sedeDestinoId} | Costo: ${precioCostoLote} | Lote: ${codigoLoteDestino}`,
          );
        }
      }

      // 7. Retornar compra actualizada
      const compraActualizada = await tx.compra.findFirst({
        where: { id },
        include: this.getInclude(),
      });

      this.logger.log(`Compra distribuida: ${compra.codigo}`);
      return compraActualizada;
    });

    // Invalidar cache de productos después de distribuir stock entre sedes
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Listar compras con filtros y paginación
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
        { codigo: { startsWith: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const limit = filtros?.limit ?? 10;

    const paginationArgs: Prisma.CompraFindManyArgs = filtros?.cursor
      ? { cursor: { id: filtros.cursor }, skip: 1, take: limit }
      : { take: limit };

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
        ...paginationArgs,
      }),
      this.prisma.compra.count({ where }),
    ]);

    return createCursorPaginatedResponse(data, total, limit, (item) => item.id);
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

    const factoresMap = dto.detalles
      ? await this._resolverFactoresCompra(empresaId, dto.detalles)
      : new Map();

    return this.prisma.$transaction(async (tx) => {
      let montosData = {};
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.compraDetalle.deleteMany({ where: { compraId: id } });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index, factoresMap),
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
            usaUnidadCompra: d.usaUnidadCompra,
            cantidadOriginal: d.cantidadOriginal,
            unidadOriginalSimbolo: d.unidadOriginalSimbolo,
            factorAplicado: d.factorAplicado,
            nuevoPrecioVenta: d.nuevoPrecioVenta,
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
          precioConfigurado: false,
        },
      });
      this.logger.warn(
        `ProductoStock creado automáticamente para sede=${sedeId}, producto=${productoId}, variante=${varianteId}. ` +
        `Nota: precioConfigurado=false, se debe configurar el precio de venta manualmente.`,
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
  /**
   * Invalidar cache de productos y estadísticas de la empresa
   */
  private async invalidateProductCache(empresaId: string): Promise<void> {
    try {
      const statsKey = this.cacheService.getEmpresaStatsKey(empresaId);
      await this.cacheService.invalidate(statsKey);
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache: ${errorMessage}`);
    }
  }

  private calcularDetalle(
    dto: CreateCompraDetalleDto,
    index: number,
    factoresMap?: Map<
      string,
      { factor: number; simboloUnidadCompra: string }
    >,
  ) {
    let cantidad = dto.cantidad;
    let precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;

    // Snapshot de unidad de compra (si aplica). Convierte cantidad y
    // precioUnitario a unidad atómica antes del cálculo de totales.
    let usaUnidadCompra = false;
    let cantidadOriginal: number | null = null;
    let factorAplicado: number | null = null;
    let unidadOriginalSimbolo: string | null = null;
    if (dto.usaUnidadCompra && dto.productoId) {
      const info = factoresMap?.get(dto.productoId);
      if (!info) {
        throw new BadRequestException(
          `Producto "${dto.descripcion}" marcado para usar unidad de compra, pero no tiene unidadCompra+factorCompra configurados.`,
        );
      }
      usaUnidadCompra = true;
      cantidadOriginal = dto.cantidad;
      factorAplicado = info.factor;
      unidadOriginalSimbolo = info.simboloUnidadCompra;
      // Cantidad en unidad atómica (Int). Round defensivo por float.
      cantidad = Math.round(dto.cantidad * info.factor);
      // Precio por unidad atómica (Decimal 12,2 → 2 decimales).
      precioUnitario = +(dto.precioUnitario / info.factor).toFixed(2);
    }

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
      usaUnidadCompra,
      cantidadOriginal,
      factorAplicado,
      unidadOriginalSimbolo,
      nuevoPrecioVenta: dto.nuevoPrecioVenta ?? null,
    };
  }

  /**
   * Carga factorCompra + símbolo de unidadCompra para todos los
   * productos referenciados en `detalles` que tienen `usaUnidadCompra`.
   * Devuelve un Map<productoId, {factor, simboloUnidadCompra}>.
   * Falla si algún producto pedido no existe o no tiene la config.
   */
  private async _resolverFactoresCompra(
    empresaId: string,
    detalles: CreateCompraDetalleDto[],
  ): Promise<Map<string, { factor: number; simboloUnidadCompra: string }>> {
    const ids = [
      ...new Set(
        detalles
          .filter((d) => d.usaUnidadCompra && d.productoId)
          .map((d) => d.productoId as string),
      ),
    ];
    if (ids.length === 0) return new Map();
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids }, empresaId },
      select: {
        id: true,
        nombre: true,
        factorCompra: true,
        unidadCompra: {
          select: {
            simboloLocal: true,
            simboloPersonalizado: true,
            unidadMaestra: { select: { simbolo: true } },
          },
        },
      },
    });
    const map = new Map<
      string,
      { factor: number; simboloUnidadCompra: string }
    >();
    for (const p of productos) {
      if (!p.factorCompra || !p.unidadCompra) {
        throw new BadRequestException(
          `Producto "${p.nombre}" no tiene unidadCompra+factorCompra configurados. Configurarlos antes de comprar por unidad de compra.`,
        );
      }
      const simbolo =
        p.unidadCompra.simboloLocal ??
        p.unidadCompra.simboloPersonalizado ??
        p.unidadCompra.unidadMaestra?.simbolo ??
        '?';
      map.set(p.id, {
        factor: Number(p.factorCompra),
        simboloUnidadCompra: simbolo,
      });
    }
    return map;
  }

  /**
   * Include estándar para queries
   */
  private getInclude() {
    return {
      detalles: {
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              factorCompra: true,
              unidadCompra: {
                select: {
                  id: true,
                  simboloLocal: true,
                  simboloPersonalizado: true,
                  unidadMaestra: { select: { simbolo: true } },
                },
              },
            },
          },
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
