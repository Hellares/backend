import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { crearMovimientoStockConValoracion } from '../../producto-stock/movimiento-stock.helper';
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
  MetodoPagoVenta,
  FuentePagoCompra,
  Prisma,
} from '@prisma/client';
import { CajaService } from '../../caja/caja.service';
import { aplicarPagoCompra, revertirPagoCompra } from '../../cuentas-por-pagar/aplicar-pago-compra.util';

@Injectable()
export class CompraService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    private readonly ordenCompraService: OrdenCompraService,
    private readonly cajaService: CajaService,
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
    const precioIncluyeIgv = dto.precioIncluyeIgv ?? true;

    return this.prisma.$transaction(async (tx) => {
      const proveedor = await tx.proveedor.findFirst({
        where: { id: dto.proveedorId, empresaId },
      });

      if (!proveedor) {
        throw new NotFoundException('Proveedor no encontrado');
      }

      const codigo = await this.configuracionCodigos.generarCodigoCompra(empresaId, tx);

      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index, factoresMap, precioIncluyeIgv),
      );

      const subtotal = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
      const totalDescuento = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
      const totalImpuestos = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      // Crédito: resuelve términos/días/vencimiento (calcula fechaVencimiento =
      // fechaRecepción + días si no viene explícita) y valida el límite de
      // crédito del proveedor.
      const fechaRecepcion = dto.fechaRecepcion ? new Date(dto.fechaRecepcion) : new Date();
      const credito = this._resolverCredito({
        terminos: dto.terminosPago ?? proveedor.terminosPago,
        diasCredito: dto.diasCredito ?? proveedor.diasCredito,
        fechaBase: fechaRecepcion,
        fechaVencimientoExplicita: dto.fechaVencimientoPago,
      });
      await this._validarLimiteCredito(tx, empresaId, proveedor, total, credito.terminosPago);

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
          terminosPago: credito.terminosPago,
          diasCredito: credito.diasCredito,
          fechaVencimientoPago: credito.fechaVencimientoPago,
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          precioIncluyeIgv,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          fechaRecepcion,
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

      // Crédito + validación de límite (igual que en create standalone).
      const fechaRecepcion = dto.fechaRecepcion ? new Date(dto.fechaRecepcion) : new Date();
      const credito = this._resolverCredito({
        terminos: dto.terminosPago ?? oc.terminosPago,
        diasCredito: dto.diasCredito ?? oc.diasCredito,
        fechaBase: fechaRecepcion,
        fechaVencimientoExplicita: dto.fechaVencimientoPago,
      });
      const proveedorOc = await tx.proveedor.findFirst({
        where: { id: oc.proveedorId, empresaId },
        select: { id: true, limiteCredito: true },
      });
      if (proveedorOc) {
        await this._validarLimiteCredito(tx, empresaId, proveedorOc, total, credito.terminosPago);
      }

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
          terminosPago: credito.terminosPago,
          diasCredito: credito.diasCredito,
          fechaVencimientoPago: credito.fechaVencimientoPago,
          moneda: dto.moneda ?? oc.moneda,
          tipoCambio: dto.tipoCambio ?? oc.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          fechaRecepcion,
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
  async confirmar(
    id: string,
    empresaId: string,
    usuarioId: string,
    pago?: {
      metodoPago: MetodoPagoVenta;
      fuente?: FuentePagoCompra;
      bancoId?: string;
      referencia?: string;
      monto?: number; // pago parcial; default = total de la compra
    },
  ) {
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
        // Costo efectivo por unidad CON IGV (= total / cantidad).
        // Consistente con la convención de retail (margen real contra
        // precio venta que también es con IGV). Independiente de si
        // la compra fue cargada con precioIncluyeIgv true o false:
        // total siempre incluye IGV.
        const precioCompra =
          detalle.cantidad > 0
            ? Number(detalle.total) / detalle.cantidad
            : Number(detalle.precioUnitario);

        // b. Calcular costo promedio ponderado
        const nuevoCosto = CompraService.calcularNuevoCostoPromedio(
          stockAnterior,
          costoAnterior,
          detalle.cantidad,
          precioCompra,
        );

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

        // d. Crear MovimientoStock (valorado al precio unitario de la línea)
        await crearMovimientoStockConValoracion(tx, {
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
          // Lo que realmente costó esta unidad en esta compra.
          precioCostoUnitario: detalle.precioUnitario,
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

      // 5a. ¿Entra al flujo de pagos (CxP)?
      //   - Crédito → siempre pagoPendiente (se paga después).
      //   - Contado + pago TOTAL → se paga ACÁ → no queda pendiente.
      //   - Contado + pago PARCIAL → paga lo indicado, el resto cae en CxP.
      //   - Contado SIN pago → cae en CxP (lo paga después).
      const total = Number(compra.total);
      const esContado = !compra.terminosPago || compra.terminosPago === 'CONTADO';
      const montoPago = Math.min(pago?.monto ?? total, total);
      if (pago && montoPago <= 0) {
        throw new BadRequestException('El monto del pago debe ser mayor a 0');
      }
      const pagarAhora = esContado && !!pago;
      // Queda pendiente si: es crédito, o contado sin pago, o contado con pago parcial.
      const pagoPendiente = !esContado || !pago || montoPago < total - 0.001;

      // 5. Actualizar compra a CONFIRMADA
      const compraConfirmada = await tx.compra.update({
        where: { id },
        data: {
          estado: EstadoCompra.CONFIRMADA,
          confirmadoPor: usuarioId,
          confirmadoEn: new Date(),
          pagoPendiente,
        },
        include: this.getInclude(),
      });

      // 5b. Si es contado y se indicó cómo se pagó, registrar el pago + egreso
      //     (reutiliza el ruteo de CxP: tesorería/caja/banco).
      if (pagarAhora) {
        await aplicarPagoCompra(tx, this.cajaService, {
          empresaId,
          compraId: id,
          usuarioId,
          sedeId: compra.sedeId,
          nombreProveedor: compra.nombreProveedor,
          codigo: compra.codigo,
          moneda: compra.moneda,
          metodoPago: pago!.metodoPago,
          monto: montoPago,
          fuente: pago!.fuente,
          bancoId: pago!.bancoId,
          referencia: pago!.referencia,
        });
      }

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
        // Valorado al precio original de la compra (lo que se reversa).
        await crearMovimientoStockConValoracion(tx, {
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
          precioCostoUnitario: precioCompra,
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

      // Revertir los pagos hechos a la compra (devuelve la plata: caja/tesorería
      // marca el movimiento anulado; banco devuelve el saldo).
      const pagos = await tx.pagoCompra.findMany({
        where: { compraId: id, anulado: false },
        select: { id: true, monto: true, fuente: true, bancoId: true, movimientoCajaId: true },
      });
      for (const pago of pagos) {
        await revertirPagoCompra(tx, pago, usuarioId, `Compra anulada (${compra.codigo})`);
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
          pagoPendiente: false,
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

        // Movimiento SALIDA en origen (valorado al costo del lote distribuido)
        await crearMovimientoStockConValoracion(tx, {
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
          precioCostoUnitario: precioCostoLote,
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

          // Movimiento ENTRADA en destino (mismo costo del lote para que
          // origen y destino registren el mismo valor del traspaso).
          await crearMovimientoStockConValoracion(tx, {
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
            precioCostoUnitario: precioCostoLote,
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
    // Si el dto trae el flag, usarlo; sino conservar el de la compra
    // existente (no asumir true que podría cambiar la convención
    // contable de una compra ya creada con flag=false).
    const precioIncluyeIgv =
      dto.precioIncluyeIgv ?? compra.precioIncluyeIgv;

    return this.prisma.$transaction(async (tx) => {
      let montosData = {};
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.compraDetalle.deleteMany({ where: { compraId: id } });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index, factoresMap, precioIncluyeIgv),
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
          precioIncluyeIgv,
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
    // XOR ProductoStock: el stock de una variante lleva productoId NULL (el
    // detalle de compra puede traer ambos; varianteId manda).
    const pid = varianteId ? null : (productoId ?? null);
    let stock = await tx.productoStock.findFirst({
      where: {
        sedeId,
        productoId: pid,
        varianteId: varianteId ?? null,
      },
    });

    if (!stock) {
      stock = await tx.productoStock.create({
        data: {
          sedeId,
          empresaId,
          productoId: pid,
          varianteId: varianteId || null,
          stockActual: 0,
          precioCosto: 0,
          precioConfigurado: false,
        },
      });
      this.logger.warn(
        `ProductoStock creado automáticamente para sede=${sedeId}, producto=${pid}, variante=${varianteId}. ` +
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
    // XOR: el stock de una variante tiene productoId NULL (varianteId manda).
    return tx.productoStock.findFirst({
      where: {
        sedeId,
        productoId: varianteId ? null : (productoId ?? null),
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

  /**
   * Costo promedio ponderado tras una entrada de compra, redondeado a 2
   * decimales. Si no había stock previo, el nuevo costo es el de la compra.
   * `cantidadEntra` y `precioCompra` van en UNIDAD ATÓMICA (ya convertidos
   * por factorCompra si la compra fue en unidad de compra).
   */
  static calcularNuevoCostoPromedio(
    stockAnterior: number,
    costoAnterior: number,
    cantidadEntra: number,
    precioCompra: number,
  ): number {
    const nuevo =
      stockAnterior <= 0
        ? precioCompra
        : (stockAnterior * costoAnterior + cantidadEntra * precioCompra) /
          (stockAnterior + cantidadEntra);
    return Math.round(nuevo * 100) / 100;
  }

  /**
   * REPOSICIÓN SUGERIDA: productos con stock ≤ stockMínimo (compras proactivas).
   * Por cada uno sugiere cuánto comprar (hasta 2× el mínimo) y a QUIÉN comprarle
   * (mejor proveedor = menor costo promedio histórico) + último costo. Ordena los
   * más críticos primero (menor stock).
   */
  async reposicionSugerida(empresaId: string, sedeId?: string) {
    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        stockMinimo: { not: null, gt: 0 },
      },
      select: {
        productoId: true,
        varianteId: true,
        sedeId: true,
        stockActual: true,
        stockMinimo: true,
        precioCosto: true,
        producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
        variante: {
          select: {
            id: true,
            nombre: true,
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
          },
        },
        sede: { select: { nombre: true } },
      },
    });
    const bajos = stocks.filter(
      (s) => s.stockMinimo != null && s.stockActual <= s.stockMinimo,
    );
    if (!bajos.length) return [];

    // Mejor proveedor + último costo por (producto/variante) desde compras
    // CONFIRMADAS, en UN solo query batcheado.
    const or = bajos.map((s) =>
      s.varianteId
        ? { varianteId: s.varianteId }
        : { productoId: s.productoId, varianteId: null },
    );
    const detalles = await this.prisma.compraDetalle.findMany({
      where: { OR: or, compra: { empresaId, estado: 'CONFIRMADA' } },
      select: {
        productoId: true,
        varianteId: true,
        cantidad: true,
        total: true,
        compra: {
          select: { proveedorId: true, nombreProveedor: true, fechaRecepcion: true },
        },
      },
    });

    const keyOf = (productoId: string | null, varianteId: string | null) =>
      varianteId ?? `p:${productoId}`;
    const aggr = new Map<string, any>();
    for (const d of detalles) {
      const k = keyOf(d.productoId, d.varianteId);
      const cu = d.cantidad > 0 ? Number(d.total) / d.cantidad : 0;
      let e = aggr.get(k);
      if (!e) {
        e = { provs: new Map(), ultimoCosto: null, ultFecha: null as Date | null };
        aggr.set(k, e);
      }
      const pk = d.compra.proveedorId ?? d.compra.nombreProveedor;
      let pe = e.provs.get(pk);
      if (!pe) {
        pe = {
          id: d.compra.proveedorId,
          nombre: d.compra.nombreProveedor,
          sumCxC: 0,
          cant: 0,
        };
        e.provs.set(pk, pe);
      }
      pe.sumCxC += cu * d.cantidad;
      pe.cant += d.cantidad;
      if (!e.ultFecha || d.compra.fechaRecepcion > e.ultFecha) {
        e.ultFecha = d.compra.fechaRecepcion;
        e.ultimoCosto = +cu.toFixed(4);
      }
    }

    return bajos
      .map((s) => {
        const nombre =
          s.producto?.nombre ?? s.variante?.producto?.nombre ?? 'Producto';
        const e = aggr.get(keyOf(s.productoId, s.varianteId));
        let mejorProveedor: any = null;
        if (e) {
          const arr = [...e.provs.values()]
            .map((p: any) => ({
              proveedorId: p.id,
              proveedor: p.nombre,
              costoPromedio: p.cant > 0 ? +(p.sumCxC / p.cant).toFixed(4) : 0,
            }))
            .sort((a, b) => a.costoPromedio - b.costoPromedio);
          mejorProveedor = arr[0] ?? null;
        }
        const min = s.stockMinimo ?? 0;
        return {
          productoId: s.productoId ?? s.variante?.producto?.id ?? null,
          varianteId: s.varianteId,
          nombre,
          varianteNombre: s.variante?.nombre ?? null,
          codigoEmpresa:
            s.producto?.codigoEmpresa ?? s.variante?.producto?.codigoEmpresa ?? null,
          sedeId: s.sedeId,
          sedeNombre: s.sede?.nombre ?? null,
          stockActual: s.stockActual,
          stockMinimo: min,
          faltante: Math.max(0, min - s.stockActual),
          sugeridoComprar: Math.max(1, min * 2 - s.stockActual),
          costoActual: s.precioCosto != null ? Number(s.precioCosto) : null,
          ultimoCosto: e?.ultimoCosto ?? null,
          mejorProveedor,
        };
      })
      .sort((a, b) => a.stockActual - b.stockActual);
  }

  /**
   * Sugiere el mapeo de los bienes de una GUÍA del proveedor → tu catálogo.
   * Por cada descripción: (1) alias guardado del proveedor (match exacto
   * normalizado) → tu producto; (2) si no, sugerencia por SIMILITUD (trigram
   * sobre Producto.nombre). Devuelve el producto sugerido + factorCompra/unidad
   * de compra para la conversión (paquete → unidades).
   */
  async sugerirMapeoGuia(
    empresaId: string,
    proveedorId: string,
    bienes: Array<{ descripcion: string; cantidad?: number; unidad?: string }>,
  ) {
    const norm = (s: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

    const aliases = await this.prisma.proveedorProducto.findMany({
      where: { empresaId, proveedorId, descripcionProveedor: { not: null }, isActive: true },
      select: { descripcionProveedor: true, productoId: true, varianteId: true },
    });
    const aliasMap = new Map(
      aliases
        .filter((a) => a.descripcionProveedor)
        .map((a) => [norm(a.descripcionProveedor as string), a]),
    );

    const filas: Array<any> = [];
    for (const b of bienes) {
      const a = aliasMap.get(norm(b.descripcion));
      if (a) {
        filas.push({
          descripcion: b.descripcion,
          cantidadGuia: b.cantidad ?? null,
          unidadGuia: b.unidad ?? null,
          productoId: a.productoId,
          varianteId: a.varianteId,
          fuente: 'alias',
        });
        continue;
      }
      // Sugerencia por similitud (trigram). Guías traen pocos bienes → N queries OK.
      let sugId: string | null = null;
      try {
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Producto"
          WHERE "empresaId" = ${empresaId} AND "isActive" = true AND nombre % ${b.descripcion}
          ORDER BY similarity(nombre, ${b.descripcion}) DESC
          LIMIT 1`;
        sugId = rows[0]?.id ?? null;
      } catch {
        sugId = null;
      }
      filas.push({
        descripcion: b.descripcion,
        cantidadGuia: b.cantidad ?? null,
        unidadGuia: b.unidad ?? null,
        productoId: sugId,
        varianteId: null,
        fuente: sugId ? 'similitud' : null,
      });
    }

    // Detalles de los productos sugeridos (nombre + factorCompra + unidad compra).
    const ids = [...new Set(filas.filter((f) => f.productoId).map((f) => f.productoId))];
    const prods = ids.length
      ? await this.prisma.producto.findMany({
          where: { id: { in: ids } },
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
        })
      : [];
    const pmap = new Map(prods.map((p) => [p.id, p]));
    return filas.map((f) => {
      const p = f.productoId ? pmap.get(f.productoId) : null;
      const uc = p?.unidadCompra;
      return {
        ...f,
        productoNombre: p?.nombre ?? null,
        factorCompra: p?.factorCompra != null ? Number(p.factorCompra) : null,
        unidadCompraSimbolo: uc
          ? (uc.simboloPersonalizado ?? uc.simboloLocal ?? uc.unidadMaestra?.simbolo ?? null)
          : null,
      };
    });
  }

  /**
   * Guarda/actualiza el alias del proveedor para tus productos (recordar que
   * "OSO AZUL" del proveedor = tu "OSO LUCIFER"). Upsert sobre ProveedorProducto.
   */
  async guardarAliasProveedor(
    empresaId: string,
    proveedorId: string,
    items: Array<{
      descripcionProveedor: string;
      productoId: string;
      varianteId?: string | null;
      precioCompra?: number;
    }>,
  ) {
    let guardados = 0;
    for (const it of items) {
      if (!it.descripcionProveedor?.trim() || !it.productoId) continue;
      const existing = await this.prisma.proveedorProducto.findFirst({
        where: { empresaId, proveedorId, productoId: it.productoId, varianteId: it.varianteId ?? null },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.proveedorProducto.update({
          where: { id: existing.id },
          data: { descripcionProveedor: it.descripcionProveedor.trim() },
        });
      } else {
        await this.prisma.proveedorProducto.create({
          data: {
            empresaId,
            proveedorId,
            productoId: it.productoId,
            varianteId: it.varianteId ?? null,
            descripcionProveedor: it.descripcionProveedor.trim(),
            precioCompra: it.precioCompra ?? 0,
          },
        });
      }
      guardados++;
    }
    return { ok: true, guardados };
  }

  /** Días de crédito: explícito si vino, si no derivado del enum TerminosPago. */
  private _diasDeTerminos(
    terminos?: string | null,
    diasExplicito?: number | null,
  ): number {
    if (diasExplicito != null && diasExplicito > 0) return diasExplicito;
    switch (terminos) {
      case 'CREDITO_7':
        return 7;
      case 'CREDITO_15':
        return 15;
      case 'CREDITO_30':
        return 30;
      case 'CREDITO_45':
        return 45;
      case 'CREDITO_60':
        return 60;
      case 'CREDITO_90':
        return 90;
      default:
        return diasExplicito ?? 0; // CONTADO / PERSONALIZADO sin días → 0
    }
  }

  /**
   * Resuelve términos de pago → { terminosPago, diasCredito, fechaVencimientoPago }.
   * Para crédito calcula fechaVencimiento = fechaBase + díasCrédito si no vino
   * explícita. Exige días o fecha para créditos (excepto que sea CONTADO).
   */
  private _resolverCredito(opts: {
    terminos?: string | null;
    diasCredito?: number | null;
    fechaBase: Date;
    fechaVencimientoExplicita?: string | null;
  }): {
    terminosPago: any;
    diasCredito: number | null;
    fechaVencimientoPago: Date | null;
  } {
    const terminos = opts.terminos ?? 'CONTADO';
    if (terminos === 'CONTADO') {
      return { terminosPago: 'CONTADO', diasCredito: null, fechaVencimientoPago: null };
    }
    const dias = this._diasDeTerminos(terminos, opts.diasCredito);
    let venc: Date | null = opts.fechaVencimientoExplicita
      ? new Date(opts.fechaVencimientoExplicita)
      : null;
    if (!venc && dias > 0) {
      venc = new Date(opts.fechaBase);
      venc.setDate(venc.getDate() + dias);
    }
    if (!venc) {
      throw new BadRequestException(
        'Compra a crédito: indicá los días de crédito o la fecha de vencimiento.',
      );
    }
    return {
      terminosPago: terminos,
      diasCredito: dias > 0 ? dias : (opts.diasCredito ?? null),
      fechaVencimientoPago: venc,
    };
  }

  /**
   * Valida el límite de crédito del proveedor: deuda actual (saldos de compras
   * CONFIRMADAS a crédito) + esta compra no debe superar `limiteCredito`. Si el
   * proveedor no tiene límite configurado, no valida.
   */
  private async _validarLimiteCredito(
    tx: any,
    empresaId: string,
    proveedor: { id: string; limiteCredito?: any },
    totalCompra: number,
    terminos: string,
  ): Promise<void> {
    if (terminos === 'CONTADO') return;
    const limite = proveedor.limiteCredito != null ? Number(proveedor.limiteCredito) : 0;
    if (!limite || limite <= 0) return;

    const compras = await tx.compra.findMany({
      where: {
        empresaId,
        proveedorId: proveedor.id,
        estado: 'CONFIRMADA',
        terminosPago: { not: 'CONTADO' },
      },
      select: { total: true, pagos: { select: { monto: true } } },
    });
    const deuda = compras.reduce((s: number, c: any) => {
      const pagado = c.pagos.reduce((p: number, x: any) => p + Number(x.monto), 0);
      return s + Math.max(0, Number(c.total) - pagado);
    }, 0);

    if (deuda + totalCompra > limite + 0.01) {
      throw new BadRequestException(
        `Límite de crédito del proveedor superado: deuda S/ ${deuda.toFixed(2)} + esta compra ` +
          `S/ ${totalCompra.toFixed(2)} supera el límite de S/ ${limite.toFixed(2)}.`,
      );
    }
  }

  private calcularDetalle(
    dto: CreateCompraDetalleDto,
    index: number,
    factoresMap?: Map<
      string,
      { factor: number; simboloUnidadCompra: string }
    >,
    precioIncluyeIgv = true,
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
      // Override puntual del empaque para ESTA compra (ej. el saco vino con
      // 40 en vez de 50) sin tocar la config del producto. Si no viene, se
      // usa el factor configurado. Se snapshotea el factor realmente usado.
      const factor =
        dto.factorCompra && dto.factorCompra > 0
          ? dto.factorCompra
          : info.factor;
      factorAplicado = factor;
      unidadOriginalSimbolo = info.simboloUnidadCompra;
      // Cantidad en unidad atómica (Int). Round defensivo por float.
      cantidad = Math.round(dto.cantidad * factor);
      // Precio por unidad atómica (Decimal 14,4 → 4 decimales).
      precioUnitario = +(dto.precioUnitario / factor).toFixed(4);
    }

    // Cálculo de IGV según convención de la compra.
    // - precioIncluyeIgv=true: el precio ingresado YA tiene IGV.
    //   subtotal (base) = bruto / (1 + igv%/100); igv = bruto - subtotal;
    //   total = bruto (lo que el user esperaba pagar).
    // - precioIncluyeIgv=false: precio es la base; igv encima; total
    //   = subtotal + igv.
    const subtotalBruto = cantidad * precioUnitario - descuento;
    let subtotal: number;
    let igv: number;
    let total: number;
    if (precioIncluyeIgv) {
      const factor = 1 + porcentajeIGV / 100;
      subtotal = subtotalBruto / factor;
      igv = subtotalBruto - subtotal;
      total = subtotalBruto;
    } else {
      subtotal = subtotalBruto;
      igv = subtotal * (porcentajeIGV / 100);
      total = subtotal + igv;
    }

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
