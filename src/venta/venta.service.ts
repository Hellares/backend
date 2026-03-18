import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
} from '@prisma/client';

@Injectable()
export class VentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
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
  ) {
    this.logger.info('Creando venta desde cotizacion', {
      empresaId,
      cotizacionId,
    });

    return this.prisma.$transaction(async (tx) => {
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

      if (cotizacion.estado !== EstadoCotizacion.APROBADA) {
        throw new BadRequestException(
          'La cotizacion debe estar en estado APROBADA para convertirla a venta',
        );
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

      const totalVenta = Number(cotizacion.total);
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
          cotizacionId: cotizacion.id,
          codigo: codigoVenta,
          nombreCliente: cotizacion.nombreCliente,
          documentoCliente: cotizacion.documentoCliente,
          emailCliente: cotizacion.emailCliente,
          telefonoCliente: cotizacion.telefonoCliente,
          direccionCliente: cotizacion.direccionCliente,
          moneda: cotizacion.moneda,
          tipoCambio: cotizacion.tipoCambio,
          subtotal: cotizacion.subtotal,
          descuento: cotizacion.descuento,
          impuestos: cotizacion.impuestos,
          total: cotizacion.total,
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
            create: cotizacion.detalles.map((d) => ({
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
        include: this.getInclude(),
      });

      // 5. Descontar stock de productos (venta POS = confirmación inmediata)
      for (const detalle of cotizacion.detalles) {
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

        // Lock para concurrencia
        const [stockLocked] = await tx.$queryRaw<
          Array<{ id: string; stockActual: number }>
        >`SELECT id, "stockActual" FROM "ProductoStock" WHERE id = ${productoStock.id} FOR UPDATE`;

        if (!stockLocked) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;
        const nuevoStock = Math.max(0, stockAnterior - cantidad);

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

      // 6. Registrar pago
      if (dto.montoRecibido && dto.montoRecibido > 0 && !esCredito) {
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

      // Sede = punto de emisión (series y correlativos)
      const sede = await tx.sede.findFirst({ where: { id: cotizacion.sedeId } });

      if (!sede) {
        this.logger.warn(`Sede ${cotizacion.sedeId} no encontrada, comprobante no generado`);
      }

      if (sede) {
        const serie = tipoComprobante === 'FACTURA'
          ? sede.serieFactura
          : sede.serieBoleta;

        let correlativo: string;
        if (tipoComprobante === 'FACTURA') {
          correlativo = String(sede.ultimoNumeroFactura + 1);
          await tx.sede.update({ where: { id: sede.id }, data: { ultimoNumeroFactura: sede.ultimoNumeroFactura + 1 } });
        } else {
          correlativo = String(sede.ultimoNumeroBoleta + 1);
          await tx.sede.update({ where: { id: sede.id }, data: { ultimoNumeroBoleta: sede.ultimoNumeroBoleta + 1 } });
        }

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
            // subtotal e impuestos ya vienen correctos de la cotización
            gravada: cotizacion.subtotal || new Prisma.Decimal(0),
            igv: cotizacion.impuestos || new Prisma.Decimal(0),
            totalIgv: cotizacion.impuestos || new Prisma.Decimal(0),
            total: cotizacion.total || new Prisma.Decimal(0),
            estado: 'REGISTRADO' as any,
            detalles: {
              create: cotizacion.detalles.map((d) => {
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
    });
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
    },
  ) {
    const where: Prisma.VentaWhereInput = { empresaId };

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

    return this.prisma.$transaction(async (tx) => {
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

    return this.prisma.$transaction(async (tx) => {
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
