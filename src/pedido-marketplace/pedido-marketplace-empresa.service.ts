import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import {
  CanalVenta,
  EstadoPedidoMarketplace,
  EstadoVenta,
  MetodoPagoVenta,
  Prisma,
  TipoMovimientoStock,
  TipoNotificacion,
} from '@prisma/client';
import { ValidarPagoDto, CambiarEstadoPedidoDto } from './dto/empresa-pedido.dto';
import { ConfiguracionEnvioDto } from './dto/configuracion-envio.dto';
import { CajaService } from '../caja/caja.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';

@Injectable()
export class PedidoMarketplaceEmpresaService {
  private readonly logger = new Logger(PedidoMarketplaceEmpresaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
    private readonly cajaService: CajaService,
    private readonly codigosService: ConfiguracionCodigosService,
  ) {}

  /**
   * Listar pedidos recibidos por la empresa
   */
  async listarPedidos(
    empresaId: string,
    filtros?: {
      estado?: EstadoPedidoMarketplace;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const where: Prisma.PedidoMarketplaceWhereInput = { empresaId };
    const page = filtros?.page ?? 1;
    const limit = filtros?.limit ?? 20;
    const skip = (page - 1) * limit;

    if (filtros?.estado) where.estado = filtros.estado;

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreComprador: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.pedidoMarketplace.findMany({
        where,
        include: {
          detalles: {
            select: {
              id: true,
              descripcion: true,
              cantidad: true,
              precioUnitario: true,
              subtotal: true,
              imagenUrl: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pedidoMarketplace.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Detalle de un pedido recibido
   */
  async detallePedido(empresaId: string, pedidoId: string) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, empresaId },
      include: {
        detalles: true,
        comprador: {
          select: {
            id: true,
            email: true,
            persona: {
              select: { nombres: true, apellidos: true, telefono: true },
            },
          },
        },
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return pedido;
  }

  /**
   * Validar pago (aprobar o rechazar)
   */
  async validarPago(
    empresaId: string,
    pedidoId: string,
    usuarioId: string,
    dto: ValidarPagoDto,
  ) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, empresaId },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (pedido.estado !== EstadoPedidoMarketplace.PAGO_ENVIADO) {
      throw new BadRequestException(
        'Solo se pueden validar pedidos con comprobante de pago enviado',
      );
    }

    if (dto.accion === 'APROBADO') {
      await this.prisma.pedidoMarketplace.update({
        where: { id: pedidoId },
        data: {
          estado: EstadoPedidoMarketplace.PAGO_VALIDADO,
          pagoValidadoEn: new Date(),
          pagoValidadoPor: usuarioId,
        },
      });

      // Notificar al comprador
      try {
        await this.notificacionService.enviarAUsuario(
          pedido.compradorId,
          'Pago validado',
          `Tu pago para el pedido #${pedido.codigo} fue aprobado. Pronto prepararemos tu pedido.`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId,
            data: { pedidoId: pedido.id },
            guardar: true,
          },
        );
      } catch (_) {}

      // Registrar ingreso en caja activa
      try {
        // Buscar primera sede de la empresa para el movimiento
        const sede = await this.prisma.sede.findFirst({
          where: { empresaId, isActive: true },
        });
        if (sede) {
          await this.cajaService.registrarMovimientoSiHayCaja(
            empresaId,
            sede.id,
            usuarioId,
            {
              tipo: 'INGRESO',
              categoria: 'PEDIDO_MARKETPLACE',
              metodoPago: pedido.metodoPago ?? 'TRANSFERENCIA',
              monto: Number(pedido.total),
              descripcion: `Pedido marketplace ${pedido.codigo}`,
              pedidoMarketplaceId: pedido.id,
            },
          );
        }
      } catch (e) {
        this.logger.warn(`Error registrando movimiento caja para pedido ${pedido.codigo}: ${e?.message ?? e}`);
      }

      return { message: 'Pago aprobado exitosamente' };
    } else {
      if (!dto.motivoRechazo) {
        throw new BadRequestException('Debe indicar el motivo del rechazo');
      }

      await this.prisma.pedidoMarketplace.update({
        where: { id: pedidoId },
        data: {
          estado: EstadoPedidoMarketplace.PAGO_RECHAZADO,
          motivoRechazo: dto.motivoRechazo,
        },
      });

      // Notificar al comprador
      try {
        await this.notificacionService.enviarAUsuario(
          pedido.compradorId,
          'Pago rechazado',
          `Tu pago para el pedido #${pedido.codigo} fue rechazado: ${dto.motivoRechazo}. Puedes enviar un nuevo comprobante.`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId,
            data: { pedidoId: pedido.id },
            guardar: true,
          },
        );
      } catch (_) {}

      return { message: 'Pago rechazado' };
    }
  }

  /**
   * Cambiar estado del pedido (EN_PREPARACION, ENVIADO)
   */
  async cambiarEstado(
    empresaId: string,
    pedidoId: string,
    usuarioId: string,
    dto: CambiarEstadoPedidoDto,
  ) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, empresaId },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    // Máquina de estados completa
    const transiciones: Record<string, EstadoPedidoMarketplace[]> = {
      [EstadoPedidoMarketplace.PAGO_VALIDADO]: [
        EstadoPedidoMarketplace.EN_PREPARACION,
        EstadoPedidoMarketplace.CANCELADO,
      ],
      [EstadoPedidoMarketplace.EN_PREPARACION]: [
        EstadoPedidoMarketplace.ENVIADO,
        EstadoPedidoMarketplace.CANCELADO,
      ],
      [EstadoPedidoMarketplace.ENVIADO]: [
        EstadoPedidoMarketplace.ENTREGADO,
      ],
    };

    const permitidos = transiciones[pedido.estado] ?? [];
    if (!permitidos.includes(dto.estado)) {
      throw new BadRequestException(
        `No se puede cambiar de ${pedido.estado} a ${dto.estado}. Permitidos: ${permitidos.join(', ') || 'ninguno'}`,
      );
    }

    const updateData: any = { estado: dto.estado };

    if (dto.estado === EstadoPedidoMarketplace.ENVIADO) {
      updateData.enviadoEn = new Date();
      if (dto.codigoSeguimiento) {
        updateData.codigoSeguimiento = dto.codigoSeguimiento;
      }
    }

    if (dto.notasVendedor) {
      updateData.notasVendedor = dto.notasVendedor;
    }

    // Si es cancelación, liberar stock reservado en transacción
    if (dto.estado === EstadoPedidoMarketplace.CANCELADO) {
      const pedidoConDetalles = await this.prisma.pedidoMarketplace.findFirst({
        where: { id: pedidoId },
        include: { detalles: true },
      });

      await this.prisma.$transaction(async (tx) => {
        if (pedidoConDetalles?.detalles) {
          for (const detalle of pedidoConDetalles.detalles) {
            const stock = await tx.productoStock.findFirst({
              where: {
                empresaId,
                productoId: detalle.varianteId ? null : detalle.productoId,
                varianteId: detalle.varianteId ?? null,
              },
            });
            if (stock && stock.stockReservadoVenta > 0) {
              await tx.productoStock.update({
                where: { id: stock.id },
                data: {
                  stockReservadoVenta: {
                    decrement: Math.min(detalle.cantidad, stock.stockReservadoVenta),
                  },
                },
              });
            }
          }
        }
        await tx.pedidoMarketplace.update({
          where: { id: pedidoId },
          data: updateData,
        });
      });
    } else if (dto.estado === EstadoPedidoMarketplace.ENVIADO) {
      // Al ENVIAR ocurre la materialización del pedido:
      // 1) Se crea la VENTA interna (canal ONLINE, sin comprobante electrónico,
      //    precios snapshot del pedido) → el pedido aparece en reportes de
      //    ventas / kardex / "vendidos". El ingreso a caja NO se duplica: ya se
      //    registró al validar el pago (categoría PEDIDO_MARKETPLACE).
      // 2) Salida REAL de inventario: hasta aquí el stock solo estaba reservado
      //    (stockReservadoVenta desde el checkout) → descontar stockActual,
      //    liberar la reserva y dejar kardex (SALIDA_VENTA) ligado a la venta.
      // ENVIADO solo se alcanza una vez (desde EN_PREPARACION) y después no hay
      // cancelación → sin doble descuento ni necesidad de anular la venta.
      const pedidoConDetalles = await this.prisma.pedidoMarketplace.findFirst({
        where: { id: pedidoId },
        include: { detalles: true },
      });

      await this.prisma.$transaction(async (tx) => {
        // Resolver la fila de stock de cada detalle con el MISMO lookup que usó
        // el checkout al reservar (así el descuento cae sobre la fila reservada).
        const lineas: { detalle: any; stock: any | null }[] = [];
        for (const detalle of pedidoConDetalles?.detalles ?? []) {
          const stock = await tx.productoStock.findFirst({
            where: {
              empresaId,
              productoId: detalle.varianteId ? null : detalle.productoId,
              varianteId: detalle.varianteId ?? null,
            },
          });
          lineas.push({ detalle, stock });
        }

        // Sede de la venta = la del stock que sale; fallback: sede de retiro o
        // primera sede activa (mismo criterio que el ingreso a caja).
        let sedeVentaId: string | null =
          lineas.find((l) => l.stock)?.stock?.sedeId ?? pedido.sedeRetiroId ?? null;
        if (!sedeVentaId) {
          const sede = await tx.sede.findFirst({
            where: { empresaId, isActive: true },
            select: { id: true },
          });
          sedeVentaId = sede?.id ?? null;
        }

        // ── Venta interna (solo si hay sede donde atribuirla) ────────────────
        if (sedeVentaId && lineas.length > 0) {
          const { codigoVenta } = await this.codigosService.generarCodigoVenta(
            empresaId,
            sedeVentaId,
            tx,
          );

          // YAPE/PLIN/TRANSFERENCIA existen 1:1 en MetodoPagoVenta.
          const metodoPagoVenta: MetodoPagoVenta =
            (pedido.metodoPago as unknown as MetodoPagoVenta) ??
            MetodoPagoVenta.TRANSFERENCIA;

          const r2 = (n: number) => Math.round(n * 100) / 100;
          const venta = await tx.venta.create({
            data: {
              empresaId,
              sedeId: sedeVentaId,
              vendedorId: usuarioId,
              canalVenta: CanalVenta.ONLINE,
              codigo: codigoVenta,
              nombreCliente: pedido.nombreComprador,
              emailCliente: pedido.emailComprador,
              telefonoCliente: pedido.telefonoComprador,
              direccionCliente: pedido.direccionEnvio,
              subtotal: pedido.subtotal,
              descuento: pedido.descuento,
              total: pedido.total,
              moneda: pedido.moneda,
              estado: EstadoVenta.PAGADA_COMPLETA,
              metodoPago: metodoPagoVenta,
              observaciones: `Pedido marketplace ${pedido.codigo}`,
              detalles: {
                create: lineas.map(({ detalle, stock }, i) => {
                  const precio = Number(detalle.precioUnitario);
                  const costo = stock?.precioCosto ? Number(stock.precioCosto) : 0;
                  const sub = Number(detalle.subtotal);
                  // Precios incluyen IGV → desglose informativo 18%.
                  const igv = r2(sub - sub / 1.18);
                  return {
                    productoId: detalle.productoId,
                    varianteId: detalle.varianteId,
                    descripcion: detalle.descripcion,
                    cantidad: detalle.cantidad,
                    precioUnitario: detalle.precioUnitario,
                    precioCostoSnapshot: costo,
                    margenSnapshot: precio - costo,
                    igv,
                    subtotal: detalle.subtotal,
                    total: detalle.subtotal,
                    orden: i,
                  };
                }),
              },
              pagos: {
                create: {
                  metodoPago: metodoPagoVenta,
                  monto: pedido.total,
                  referencia: pedido.transaccionExternaId ?? pedido.codigo,
                },
              },
            },
            select: { id: true },
          });

          updateData.ventaId = venta.id;
        }

        // ── Salida real de inventario + kardex ligado a la venta ─────────────
        for (const { detalle, stock } of lineas) {
          // Sin fila de stock (producto eliminado): no bloquear el envío.
          if (!stock) continue;

          await tx.productoStock.update({
            where: { id: stock.id },
            data: {
              stockActual: { decrement: detalle.cantidad },
              stockReservadoVenta: {
                decrement: Math.min(detalle.cantidad, stock.stockReservadoVenta),
              },
            },
          });

          await crearMovimientoStockConValoracion(tx, {
            productoStockId: stock.id,
            empresaId,
            sedeId: stock.sedeId,
            tipo: TipoMovimientoStock.SALIDA_VENTA,
            cantidad: -detalle.cantidad,
            cantidadAnterior: stock.stockActual,
            cantidadNueva: stock.stockActual - detalle.cantidad,
            usuarioId,
            motivo: 'Pedido marketplace enviado',
            tipoDocumento: 'PEDIDO_MARKETPLACE',
            numeroDocumento: pedido.codigo,
            ventaId: updateData.ventaId,
          });
        }

        await tx.pedidoMarketplace.update({
          where: { id: pedidoId },
          data: updateData,
        });
      });
    } else {
      await this.prisma.pedidoMarketplace.update({
        where: { id: pedidoId },
        data: updateData,
      });
    }

    // Notificar al comprador
    const mensajes: Record<string, string> = {
      [EstadoPedidoMarketplace.EN_PREPARACION]:
        `Tu pedido #${pedido.codigo} está siendo preparado`,
      [EstadoPedidoMarketplace.ENVIADO]:
        `Tu pedido #${pedido.codigo} ha sido enviado${dto.codigoSeguimiento ? `. Seguimiento: ${dto.codigoSeguimiento}` : ''}`,
    };

    try {
      await this.notificacionService.enviarAUsuario(
        pedido.compradorId,
        dto.estado === EstadoPedidoMarketplace.ENVIADO ? 'Pedido enviado' : 'Pedido en preparación',
        mensajes[dto.estado] ?? `Tu pedido #${pedido.codigo} cambió a ${dto.estado}`,
        {
          tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
          empresaId,
          data: { pedidoId: pedido.id },
          guardar: true,
        },
      );
    } catch (_) {}

    return { message: `Estado actualizado a ${dto.estado}` };
  }

  /**
   * Resumen de pedidos para dashboard
   */
  async resumen(empresaId: string) {
    const [pendientesPago, pagoEnviado, enPreparacion, enviados, totalMes] = await Promise.all([
      this.prisma.pedidoMarketplace.count({
        where: { empresaId, estado: EstadoPedidoMarketplace.PENDIENTE_PAGO },
      }),
      this.prisma.pedidoMarketplace.count({
        where: { empresaId, estado: EstadoPedidoMarketplace.PAGO_ENVIADO },
      }),
      this.prisma.pedidoMarketplace.count({
        where: { empresaId, estado: EstadoPedidoMarketplace.EN_PREPARACION },
      }),
      this.prisma.pedidoMarketplace.count({
        where: { empresaId, estado: EstadoPedidoMarketplace.ENVIADO },
      }),
      this.prisma.pedidoMarketplace.count({
        where: {
          empresaId,
          creadoEn: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    return {
      pendientesPago,
      pagoEnviado,
      enPreparacion,
      enviados,
      totalMes,
      requierenAccion: pagoEnviado,
    };
  }

  /**
   * Obtener configuración de envío
   */
  async getConfiguracionEnvio(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        envioGratisDesde: true,
        permiteRetiroTienda: true,
      },
    });

    return {
      envioGratisDesde: empresa?.envioGratisDesde ? Number(empresa.envioGratisDesde) : null,
      permiteRetiroTienda: empresa?.permiteRetiroTienda ?? false,
    };
  }

  /**
   * Actualizar configuración de envío
   */
  async updateConfiguracionEnvio(empresaId: string, dto: ConfiguracionEnvioDto) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        ...(dto.envioGratisDesde !== undefined && { envioGratisDesde: dto.envioGratisDesde }),
        ...(dto.permiteRetiroTienda !== undefined && { permiteRetiroTienda: dto.permiteRetiroTienda }),
      },
    });

    return this.getConfiguracionEnvio(empresaId);
  }
}
