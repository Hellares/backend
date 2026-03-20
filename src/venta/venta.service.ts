import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CreateVentaDesdeCotizacionDto } from './dto/create-venta-desde-cotizacion.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { ProcesarPagoDto } from './dto/procesar-pago.dto';
import { CreateVentaDetalleDto } from './dto/create-venta-detalle.dto';
import {
  EstadoVenta,
  EstadoCotizacion,
  TipoMovimientoStock,
  Prisma,
  Rol,
} from '@prisma/client';

@Injectable()
export class VentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(VentaService.name);
  }

  // Include reutilizable para queries
  private getInclude() {
    return {
      detalles: {
        include: {
          producto: {
            select: { id: true, nombre: true, codigoEmpresa: true },
          },
          variante: { select: { id: true, nombre: true, sku: true } },
          servicio: {
            select: { id: true, nombre: true, codigoEmpresa: true },
          },
        },
        orderBy: { orden: 'asc' as const },
      },
      pagos: { orderBy: { fechaPago: 'desc' as const } },
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
      cajero: {
        select: {
          id: true,
          persona: { select: { nombres: true, apellidos: true } },
        },
      },
      cotizacion: { select: { id: true, codigo: true } },
    };
  }

  private getListInclude() {
    return {
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
      cotizacion: { select: { id: true, codigo: true } },
      _count: { select: { detalles: true, pagos: true } },
    };
  }

  /**
   * Crear venta (estado BORRADOR)
   */
  async create(empresaId: string, dto: CreateVentaDto) {
    this.logger.info('Creando venta', { empresaId, sede: dto.sedeId });

    return this.prisma.$transaction(async (tx) => {
      const { codigoVenta } =
        await this.configuracionCodigos.generarCodigoVenta(
          empresaId,
          dto.sedeId,
          tx,
        );

      const detallesCalculados = dto.detalles.map((d, index) =>
        this.calcularDetalle(d, index),
      );

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

      const montoCambio =
        dto.montoRecibido && dto.montoRecibido > total
          ? Math.round((dto.montoRecibido - total) * 100) / 100
          : null;

      const venta = await tx.venta.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          clienteId: dto.clienteId,
          clienteEmpresaId: dto.clienteEmpresaId,
          vendedorId: dto.vendedorId,
          codigo: codigoVenta,
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
          metodoPago: dto.metodoPago,
          montoRecibido: dto.montoRecibido,
          montoCambio,
          esCredito: dto.esCredito ?? false,
          plazoCredito: dto.plazoCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          observaciones: dto.observaciones,
          detalles: {
            create: detallesCalculados.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              comboId: d.comboId,
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

      this.logger.log(`Venta creada: ${venta.codigo}`);
      return venta;
    });
  }

  /**
   * Crear venta desde cotización aprobada
   */
  async crearDesdeCotizacion(
    empresaId: string,
    cotizacionId: string,
    dto: CreateVentaDesdeCotizacionDto,
    cajeroId?: string,
  ) {
    this.logger.info('Creando venta desde cotizacion', {
      empresaId,
      cotizacionId,
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
      // 1. Validar cotización
      const cotizacion = await tx.cotizacion.findFirst({
        where: { id: cotizacionId, empresaId },
        include: {
          detalles: { orderBy: { orden: 'asc' } },
        },
      });

      if (!cotizacion) {
        throw new NotFoundException('Cotizacion no encontrada');
      }

      if (
        cotizacion.estado !== EstadoCotizacion.APROBADA &&
        cotizacion.estado !== EstadoCotizacion.PENDIENTE
      ) {
        throw new BadRequestException(
          'La cotizacion debe estar en estado PENDIENTE o APROBADA para convertirla a venta',
        );
      }

      // 1b. Si está en PENDIENTE, aprobar automáticamente dentro de la transacción
      if (cotizacion.estado === EstadoCotizacion.PENDIENTE) {
        await tx.cotizacion.update({
          where: { id: cotizacion.id },
          data: { estado: EstadoCotizacion.APROBADA },
        });
      }

      // 2. Protección contra duplicados
      if (cotizacion.ventaId) {
        throw new BadRequestException(
          'Esta cotización ya fue convertida a venta',
        );
      }

      // 3. Generar código de venta
      const { codigoVenta } =
        await this.configuracionCodigos.generarCodigoVenta(
          empresaId,
          cotizacion.sedeId,
          tx,
        );

      // 3b. Filtrar detalles excluidos y ajustar cantidades
      const excluirIds = new Set(dto.excluirDetalleIds ?? []);
      const ajustes = dto.ajustarCantidades ?? {};
      const hayModificaciones = excluirIds.size > 0 || Object.keys(ajustes).length > 0;

      // Filtrar excluidos y aplicar ajustes de cantidad
      const detallesVenta = cotizacion.detalles
        .filter((d) => !excluirIds.has(d.id))
        .map((d) => {
          if (ajustes[d.id] !== undefined) {
            const nuevaCantidad = ajustes[d.id];
            const precioUnit = Number(d.precioUnitario);
            const descUnit = Number(d.descuento) / Number(d.cantidad);
            const nuevoDescuento = descUnit * nuevaCantidad;
            const nuevoSubtotal = (precioUnit * nuevaCantidad) - nuevoDescuento;
            const porcentajeIGV = Number(d.porcentajeIGV) / 100;
            const nuevoIgv = Math.round(nuevoSubtotal * porcentajeIGV * 100) / 100;
            const nuevoTotal = nuevoSubtotal + nuevoIgv;
            return {
              ...d,
              cantidad: new Prisma.Decimal(nuevaCantidad),
              descuento: new Prisma.Decimal(nuevoDescuento.toFixed(2)),
              subtotal: new Prisma.Decimal(nuevoSubtotal.toFixed(2)),
              igv: new Prisma.Decimal(nuevoIgv.toFixed(2)),
              total: new Prisma.Decimal(nuevoTotal.toFixed(2)),
            };
          }
          return d;
        });

      if (detallesVenta.length === 0) {
        throw new BadRequestException(
          'No quedan items para crear la venta',
        );
      }

      // Recalcular totales si hubo modificaciones
      let subtotalVenta: number;
      let descuentoVenta: number;
      let impuestosVenta: number;
      let totalVenta: number;

      // 3c. Procesar items adicionales agregados por el cajero
      const itemsAdicionales = (dto.itemsAdicionales ?? []).map((item) => {
        const cantidad = item.cantidad;
        const precioUnitario = item.precioUnitario;
        const descuento = item.descuento ?? 0;
        const porcentajeIGV = item.porcentajeIGV ?? 18;
        const subtotal = (cantidad * precioUnitario) - descuento;
        const igv = Math.round(subtotal * (porcentajeIGV / 100) * 100) / 100;
        const total = subtotal + igv;
        return {
          productoId: item.productoId || null,
          varianteId: item.varianteId || null,
          servicioId: item.servicioId || null,
          descripcion: item.descripcion,
          cantidad: new Prisma.Decimal(cantidad),
          precioUnitario: new Prisma.Decimal(precioUnitario),
          descuento: new Prisma.Decimal(descuento),
          porcentajeIGV: new Prisma.Decimal(porcentajeIGV),
          igv: new Prisma.Decimal(igv.toFixed(2)),
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(total.toFixed(2)),
          orden: 0,
          // Guardar valores numéricos para stock
          _cantidad: cantidad,
          _subtotal: subtotal,
          _descuento: descuento,
          _igv: igv,
          _total: total,
        };
      });

      const hayItems = hayModificaciones || itemsAdicionales.length > 0;

      if (hayItems) {
        const cotSubtotal = detallesVenta.reduce((sum, d) => sum + Number(d.subtotal || 0), 0);
        const cotDescuento = detallesVenta.reduce((sum, d) => sum + Number(d.descuento || 0), 0);
        const cotImpuestos = detallesVenta.reduce((sum, d) => sum + Number(d.igv || 0), 0);
        const cotTotal = detallesVenta.reduce((sum, d) => sum + Number(d.total || 0), 0);

        const addSubtotal = itemsAdicionales.reduce((sum, i) => sum + i._subtotal, 0);
        const addDescuento = itemsAdicionales.reduce((sum, i) => sum + i._descuento, 0);
        const addImpuestos = itemsAdicionales.reduce((sum, i) => sum + i._igv, 0);
        const addTotal = itemsAdicionales.reduce((sum, i) => sum + i._total, 0);

        subtotalVenta = cotSubtotal + addSubtotal;
        descuentoVenta = cotDescuento + addDescuento;
        impuestosVenta = cotImpuestos + addImpuestos;
        totalVenta = cotTotal + addTotal;
      } else {
        subtotalVenta = Number(cotizacion.subtotal);
        descuentoVenta = Number(cotizacion.descuento);
        impuestosVenta = Number(cotizacion.impuestos);
        totalVenta = Number(cotizacion.total);
      }

      const montoCambio =
        dto.montoRecibido && dto.montoRecibido > totalVenta
          ? Math.round((dto.montoRecibido - totalVenta) * 100) / 100
          : null;

      // Determinar estado de la venta
      const esCredito = dto.esCredito ?? false;
      const estaPagada = !esCredito && dto.montoRecibido && dto.montoRecibido >= totalVenta;

      // 4. Crear venta con datos de la cotización
      const venta = await tx.venta.create({
        data: {
          empresaId,
          sedeId: cotizacion.sedeId,
          clienteId: cotizacion.clienteId,
          clienteEmpresaId: cotizacion.clienteEmpresaId,
          vendedorId: cotizacion.vendedorId,
          cajeroId: cajeroId || null,
          cotizacionId: cotizacion.id,
          codigo: codigoVenta,
          nombreCliente: cotizacion.nombreCliente,
          documentoCliente: cotizacion.documentoCliente,
          emailCliente: cotizacion.emailCliente,
          telefonoCliente: cotizacion.telefonoCliente,
          direccionCliente: cotizacion.direccionCliente,
          moneda: cotizacion.moneda,
          tipoCambio: cotizacion.tipoCambio,
          subtotal: new Prisma.Decimal(subtotalVenta.toFixed(2)),
          descuento: new Prisma.Decimal(descuentoVenta.toFixed(2)),
          impuestos: new Prisma.Decimal(impuestosVenta.toFixed(2)),
          total: new Prisma.Decimal(totalVenta.toFixed(2)),
          metodoPago: dto.metodoPago,
          montoRecibido: dto.montoRecibido,
          montoCambio,
          esCredito,
          plazoCredito: dto.plazoCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          observaciones: dto.observaciones ?? cotizacion.observaciones,
          // Venta POS: CONFIRMADA (con stock descontado) o PAGADA_COMPLETA
          estado: estaPagada ? EstadoVenta.PAGADA_COMPLETA : EstadoVenta.CONFIRMADA,
          detalles: {
            create: [
              ...detallesVenta.map((d) => ({
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
              ...itemsAdicionales.map((d, i) => ({
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
                orden: detallesVenta.length + i,
              })),
            ],
          },
        },
        include: this.getInclude(),
      });

      // 5. Descontar stock de productos (venta POS = confirmación inmediata)
      const todosLosDetalles = [...detallesVenta, ...itemsAdicionales];
      for (const detalle of todosLosDetalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue; // Servicios no afectan stock
        }

        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: cotizacion.sedeId,
            productoId: detalle.productoId ?? null,
            varianteId: detalle.varianteId ?? null,
          },
        });

        if (!productoStock) {
          this.logger.warn(`No existe stock para "${detalle.descripcion}" en sede ${cotizacion.sedeId}`);
          continue;
        }

        // Lock para concurrencia — lectura con todos los campos de reserva
        const [stockLocked] = await tx.$queryRaw<
          Array<{
            id: string;
            stockActual: number;
            stockReservado: number;
            stockReservadoVenta: number;
            stockReservadoCombo: number;
            stockDanado: number;
            stockEnGarantia: number;
          }>
        >`SELECT id, "stockActual", "stockReservado", "stockReservadoVenta",
                "stockReservadoCombo", "stockDanado", "stockEnGarantia"
         FROM "ProductoStock" WHERE id = ${productoStock.id} FOR UPDATE`;

        if (!stockLocked) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;
        const stockDisponible =
          stockAnterior -
          stockLocked.stockReservado -
          stockLocked.stockReservadoVenta -
          stockLocked.stockReservadoCombo -
          stockLocked.stockDanado -
          stockLocked.stockEnGarantia;

        if (cantidad > stockDisponible) {
          throw new BadRequestException(
            `Stock insuficiente para "${detalle.descripcion}". Disponible: ${stockDisponible}, Requerido: ${cantidad}`,
          );
        }

        const nuevoStock = stockAnterior - cantidad;

        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        await tx.movimientoStock.create({
          data: {
            sedeId: cotizacion.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.SALIDA_VENTA,
            tipoDocumento: 'VENTA',
            numeroDocumento: codigoVenta,
            cantidadAnterior: stockAnterior,
            cantidad: -cantidad,
            cantidadNueva: nuevoStock,
            motivo: `Venta POS ${codigoVenta} - ${detalle.descripcion}`,
            ventaId: venta.id,
            usuarioId: cotizacion.vendedorId,
          },
        });
      }

      // 6. Registrar pagos (múltiples o único legacy)
      if (dto.pagos && dto.pagos.length > 0 && !esCredito) {
        for (const pago of dto.pagos) {
          await tx.pagoVenta.create({
            data: {
              ventaId: venta.id,
              metodoPago: pago.metodoPago as any,
              monto: pago.monto,
              referencia: pago.referencia || null,
              monedaOriginal: (pago as any).monedaOriginal || null,
              montoOriginal: (pago as any).montoOriginal || null,
              tipoCambio: (pago as any).tipoCambio || null,
            },
          });
        }
      } else if (dto.montoRecibido && dto.montoRecibido > 0 && !esCredito) {
        // Fallback: pago único (compatibilidad)
        await tx.pagoVenta.create({
          data: {
            ventaId: venta.id,
            metodoPago: dto.metodoPago || 'EFECTIVO',
            monto: Math.min(dto.montoRecibido, totalVenta),
            referencia: dto.referenciaPago || null,
          },
        });
      }

      // 7. Crear comprobante electrónico
      const tipoComprobante = dto.tipoComprobante || 'BOLETA';

      // ConfiguracionFacturacion = datos tributarios globales (IGV, credenciales SUNAT)
      const configFacturacion = await tx.configuracionFacturacion.findUnique({
        where: { empresaId },
      });

      // Sede = punto de emisión (series y correlativos) — FOR UPDATE para concurrencia
      const [sedeLocked] = await tx.$queryRaw<
        Array<{
          id: string;
          serieFactura: string;
          serieBoleta: string;
          ultimoNumeroFactura: number;
          ultimoNumeroBoleta: number;
        }>
      >`SELECT id, "serieFactura", "serieBoleta", "ultimoNumeroFactura", "ultimoNumeroBoleta"
        FROM "Sede" WHERE id = ${cotizacion.sedeId} FOR UPDATE`;

      if (!sedeLocked) {
        this.logger.warn(`Sede ${cotizacion.sedeId} no encontrada, comprobante no generado`);
      }

      if (sedeLocked) {
        const serie = tipoComprobante === 'FACTURA'
          ? sedeLocked.serieFactura
          : sedeLocked.serieBoleta;

        const nuevoCorrelativo = tipoComprobante === 'FACTURA'
          ? sedeLocked.ultimoNumeroFactura + 1
          : sedeLocked.ultimoNumeroBoleta + 1;

        const correlativo = String(nuevoCorrelativo);

        await tx.sede.update({
          where: { id: sedeLocked.id },
          data: tipoComprobante === 'FACTURA'
            ? { ultimoNumeroFactura: nuevoCorrelativo }
            : { ultimoNumeroBoleta: nuevoCorrelativo },
        });

        const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;

        // Usar subtotal e IGV ya calculados en la cotización (ya contemplan precioIncluyeIgv)
        const comprobante = await tx.comprobanteElectronico.create({
          data: {
            empresaId,
            clienteId: cotizacion.clienteId,
            clienteEmpresaId: cotizacion.clienteEmpresaId,
            tipoComprobante: tipoComprobante as any,
            serie,
            correlativo: correlativo.padStart(8, '0'),
            codigoGenerado,
            tipoDocumento: dto.tipoDocumentoCliente || (tipoComprobante === 'FACTURA' ? '6' : '1'),
            numeroDocumento: cotizacion.documentoCliente,
            nombreCliente: cotizacion.nombreCliente || 'CLIENTE VARIOS',
            direccionCliente: cotizacion.direccionCliente,
            emailCliente: cotizacion.emailCliente,
            moneda: cotizacion.moneda || 'PEN',
            // Usar totales recalculados (pueden diferir si se excluyeron ítems)
            gravada: new Prisma.Decimal(subtotalVenta.toFixed(2)),
            igv: new Prisma.Decimal(impuestosVenta.toFixed(2)),
            totalIgv: new Prisma.Decimal(impuestosVenta.toFixed(2)),
            total: new Prisma.Decimal(totalVenta.toFixed(2)),
            estado: 'REGISTRADO' as any,
            detalles: {
              create: detallesVenta.map((d) => {
                // Usar subtotal e IGV ya calculados por item (respetan precioIncluyeIgv)
                const subtotalItem = Number(d.subtotal || 0);
                const igvItem = Number(d.igv || 0);
                const totalItem = Number(d.total || subtotalItem + igvItem);
                const cant = Number(d.cantidad || 1);
                const valorUnit = cant > 0 ? subtotalItem / cant : 0;
                const precioUnit = cant > 0 ? totalItem / cant : 0;
                return {
                  descripcion: d.descripcion,
                  cantidad: d.cantidad,
                  valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
                  precioUnitario: new Prisma.Decimal(precioUnit.toFixed(2)),
                  valorVenta: new Prisma.Decimal(subtotalItem.toFixed(2)),
                  igv: new Prisma.Decimal(igvItem.toFixed(2)),
                  subtotal: new Prisma.Decimal(subtotalItem.toFixed(2)),
                  total: new Prisma.Decimal(totalItem.toFixed(2)),
                  ...(d.productoId ? { producto: { connect: { id: d.productoId } } } : {}),
                };
              }),
            },
          },
        });

        // Registrar pago del comprobante (registro tributario)
        const montoPago = esCredito
          ? 0
          : Math.min(dto.montoRecibido || totalVenta, totalVenta);

        await tx.pagoComprobante.create({
          data: {
            comprobanteId: comprobante.id,
            metodoPago: dto.metodoPago || 'EFECTIVO',
            monto: new Prisma.Decimal(montoPago.toFixed(2)),
            referencia: dto.referenciaPago || null,
            estado: esCredito ? 'PENDIENTE' : 'COMPLETADO',
          },
        });

        this.logger.log(`Comprobante ${codigoGenerado} generado para venta ${venta.codigo}`);
      }

      // 8. Cambiar estado de cotización a CONVERTIDA
      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: {
          estado: EstadoCotizacion.CONVERTIDA,
          ventaId: venta.id,
        },
      });

      this.logger.log(
        `Venta ${venta.codigo} creada desde cotizacion ${cotizacion.codigo}`,
      );
      return venta;
    },
    { timeout: 30000 }, // 30s para operaciones con múltiples locks de stock
    );

    // Invalidar cache de productos después de descontar stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Listar ventas con filtros
   */
  async findAll(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoVenta;
      fechaDesde?: string;
      fechaHasta?: string;
      clienteId?: string;
      search?: string;
      userId?: string;
      userRole?: string;
    },
  ) {
    const where: Prisma.VentaWhereInput = { empresaId };

    // Vendedor solo ve ventas originadas de sus cotizaciones
    if (filtros?.userRole === Rol.VENDEDOR && filtros?.userId) {
      where.vendedorId = filtros.userId;
    }
    // Cajero solo ve ventas que procesó
    if (filtros?.userRole === Rol.CAJERO && filtros?.userId) {
      where.cajeroId = filtros.userId;
    }

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.clienteId) where.clienteId = filtros.clienteId;

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaVenta = {};
      if (filtros.fechaDesde)
        where.fechaVenta.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta)
        where.fechaVenta.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
        {
          documentoCliente: {
            contains: filtros.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return this.prisma.venta.findMany({
      where,
      include: this.getListInclude(),
      orderBy: { creadoEn: 'desc' },
    });
  }

  /**
   * Detalle completo de una venta
   */
  async findOne(id: string, empresaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id, empresaId },
      include: this.getInclude(),
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    return venta;
  }

  /**
   * Actualizar venta (solo BORRADOR)
   */
  async update(id: string, empresaId: string, dto: UpdateVentaDto) {
    const venta = await this.prisma.venta.findFirst({
      where: { id, empresaId },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (venta.estado !== EstadoVenta.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden editar ventas en estado BORRADOR',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.ventaDetalle.deleteMany({ where: { ventaId: id } });

        const detallesCalculados = dto.detalles.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        await tx.ventaDetalle.createMany({
          data: detallesCalculados.map((d) => ({
            ventaId: id,
            productoId: d.productoId,
            varianteId: d.varianteId,
            servicioId: d.servicioId,
            comboId: d.comboId,
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

        return tx.venta.update({
          where: { id },
          data: {
            ...this.buildUpdateData(dto),
            subtotal,
            descuento: totalDescuento,
            impuestos: totalImpuestos,
            total,
          },
          include: this.getInclude(),
        });
      }

      return tx.venta.update({
        where: { id },
        data: this.buildUpdateData(dto),
        include: this.getInclude(),
      });
    });
  }

  /**
   * Confirmar venta → impacta stock
   */
  async confirmar(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Confirmando venta', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { detalles: true },
      });

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado !== EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'Solo se puede confirmar una venta en estado BORRADOR',
        );
      }

      // Procesar stock para cada detalle con producto/variante
      for (const detalle of venta.detalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue; // Servicios no afectan stock
        }

        // Buscar ProductoStock
        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: venta.sedeId,
            productoId: detalle.productoId ?? null,
            varianteId: detalle.varianteId ?? null,
          },
        });

        if (!productoStock) {
          throw new BadRequestException(
            `No existe stock para "${detalle.descripcion}" en esta sede`,
          );
        }

        // SELECT FOR UPDATE
        const [stockLocked] = await tx.$queryRaw<
          Array<{ id: string; stockActual: number; sedeId: string }>
        >`SELECT id, "stockActual", "sedeId"
          FROM "ProductoStock"
          WHERE id = ${productoStock.id}
          FOR UPDATE`;

        if (!stockLocked) {
          throw new NotFoundException(
            `ProductoStock no encontrado para "${detalle.descripcion}"`,
          );
        }

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;

        // Calcular stock disponible para venta
        const stockDisponible =
          stockAnterior -
          productoStock.stockReservado -
          productoStock.stockReservadoVenta -
          productoStock.stockReservadoCombo -
          productoStock.stockDanado -
          productoStock.stockEnGarantia;

        if (cantidad > stockDisponible) {
          throw new BadRequestException(
            `Stock insuficiente para "${detalle.descripcion}". ` +
              `Disponible: ${stockDisponible}, Solicitado: ${cantidad}`,
          );
        }

        const nuevoStock = stockAnterior - cantidad;

        // Decrementar stock
        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        // Crear MovimientoStock
        await tx.movimientoStock.create({
          data: {
            sedeId: venta.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.SALIDA_VENTA,
            tipoDocumento: 'VENTA',
            numeroDocumento: venta.codigo,
            cantidadAnterior: stockAnterior,
            cantidad: -cantidad,
            cantidadNueva: nuevoStock,
            motivo: `Venta ${venta.codigo} - ${detalle.descripcion}`,
            ventaId: venta.id,
            usuarioId,
          },
        });
      }

      // Actualizar estado
      const updatedVenta = await tx.venta.update({
        where: { id },
        data: { estado: EstadoVenta.CONFIRMADA },
        include: this.getInclude(),
      });

      this.logger.log(`Venta confirmada: ${venta.codigo}`);
      return updatedVenta;
    });

    // Invalidar cache de productos después de descontar stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Registrar pago
   */
  async procesarPago(
    id: string,
    empresaId: string,
    dto: ProcesarPagoDto,
  ) {
    this.logger.info('Procesando pago', { id, empresaId });

    return this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { pagos: true },
      });

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado === EstadoVenta.ANULADA) {
        throw new BadRequestException(
          'No se puede registrar pago en una venta anulada',
        );
      }

      if (venta.estado === EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'La venta debe estar confirmada antes de registrar pagos',
        );
      }

      // Crear pago
      await tx.pagoVenta.create({
        data: {
          ventaId: id,
          metodoPago: dto.metodoPago,
          monto: dto.monto,
          referencia: dto.referencia,
        },
      });

      // Calcular total pagado
      const pagosExistentes = venta.pagos.reduce(
        (sum, p) => sum + Number(p.monto),
        0,
      );
      const totalPagado = pagosExistentes + dto.monto;
      const ventaTotal = Number(venta.total);

      // Determinar nuevo estado
      let nuevoEstado = venta.estado;
      if (totalPagado >= ventaTotal) {
        nuevoEstado = EstadoVenta.PAGADA_COMPLETA;
      } else if (totalPagado > 0) {
        nuevoEstado = EstadoVenta.PAGADA_PARCIAL;
      }

      const montoCambio =
        totalPagado > ventaTotal
          ? Math.round((totalPagado - ventaTotal) * 100) / 100
          : 0;

      const updatedVenta = await tx.venta.update({
        where: { id },
        data: {
          estado: nuevoEstado,
          montoRecibido: totalPagado,
          montoCambio,
          metodoPago: dto.metodoPago,
        },
        include: this.getInclude(),
      });

      this.logger.log(
        `Pago registrado en venta ${venta.codigo}: ${dto.monto} (${dto.metodoPago})`,
      );
      return updatedVenta;
    });
  }

  /**
   * Anular venta → reversar stock
   */
  async anular(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Anulando venta', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { detalles: true },
      });

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado === EstadoVenta.ANULADA) {
        throw new BadRequestException('La venta ya esta anulada');
      }

      if (venta.estado === EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'No se puede anular una venta en BORRADOR, eliminela en su lugar',
        );
      }

      // Reversar stock para cada detalle con producto/variante
      for (const detalle of venta.detalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue;
        }

        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: venta.sedeId,
            productoId: detalle.productoId ?? null,
            varianteId: detalle.varianteId ?? null,
          },
        });

        if (!productoStock) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = productoStock.stockActual;
        const nuevoStock = stockAnterior + cantidad;

        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        await tx.movimientoStock.create({
          data: {
            sedeId: venta.sedeId,
            empresaId,
            productoStockId: productoStock.id,
            tipo: TipoMovimientoStock.AJUSTE_SALIDA_VENTA,
            tipoDocumento: 'VENTA',
            numeroDocumento: venta.codigo,
            cantidadAnterior: stockAnterior,
            cantidad: cantidad,
            cantidadNueva: nuevoStock,
            motivo: `Anulacion venta ${venta.codigo} - ${detalle.descripcion}`,
            ventaId: venta.id,
            usuarioId,
          },
        });
      }

      // Si vino de cotización, revertir a APROBADA
      if (venta.cotizacionId) {
        await tx.cotizacion.update({
          where: { id: venta.cotizacionId },
          data: {
            estado: EstadoCotizacion.APROBADA,
            ventaId: null,
          },
        });
      }

      const updatedVenta = await tx.venta.update({
        where: { id },
        data: { estado: EstadoVenta.ANULADA },
        include: this.getInclude(),
      });

      this.logger.log(`Venta anulada: ${venta.codigo}`);
      return updatedVenta;
    });

    // Invalidar cache de productos después de restaurar stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Resumen de ventas para dashboard
   */
  async getResumen(empresaId: string, sedeId?: string) {
    const where: Prisma.VentaWhereInput = { empresaId };
    if (sedeId) where.sedeId = sedeId;

    const [totalVentas, ventasHoy, ventasPorEstado] = await Promise.all([
      this.prisma.venta.count({ where }),
      this.prisma.venta.count({
        where: {
          ...where,
          fechaVenta: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.venta.groupBy({
        by: ['estado'],
        where,
        _count: true,
        _sum: { total: true },
      }),
    ]);

    return {
      totalVentas,
      ventasHoy,
      porEstado: ventasPorEstado.map((g) => ({
        estado: g.estado,
        cantidad: g._count,
        total: g._sum.total ? Number(g._sum.total) : 0,
      })),
    };
  }

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

  private calcularDetalle(dto: CreateVentaDetalleDto, index: number) {
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
      servicioId: dto.servicioId || null,
      comboId: dto.comboId || null,
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

  private buildUpdateData(dto: UpdateVentaDto) {
    return {
      ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
      ...(dto.clienteEmpresaId !== undefined && {
        clienteEmpresaId: dto.clienteEmpresaId,
      }),
      ...(dto.nombreCliente !== undefined && {
        nombreCliente: dto.nombreCliente,
      }),
      ...(dto.documentoCliente !== undefined && {
        documentoCliente: dto.documentoCliente,
      }),
      ...(dto.emailCliente !== undefined && {
        emailCliente: dto.emailCliente,
      }),
      ...(dto.telefonoCliente !== undefined && {
        telefonoCliente: dto.telefonoCliente,
      }),
      ...(dto.direccionCliente !== undefined && {
        direccionCliente: dto.direccionCliente,
      }),
      ...(dto.moneda !== undefined && { moneda: dto.moneda }),
      ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
      ...(dto.metodoPago !== undefined && { metodoPago: dto.metodoPago }),
      ...(dto.montoRecibido !== undefined && {
        montoRecibido: dto.montoRecibido,
      }),
      ...(dto.esCredito !== undefined && { esCredito: dto.esCredito }),
      ...(dto.plazoCredito !== undefined && {
        plazoCredito: dto.plazoCredito,
      }),
      ...(dto.fechaVencimientoPago !== undefined && {
        fechaVencimientoPago: dto.fechaVencimientoPago
          ? new Date(dto.fechaVencimientoPago)
          : null,
      }),
      ...(dto.observaciones !== undefined && {
        observaciones: dto.observaciones,
      }),
    };
  }
}
