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
  MetodoPagoMarketplace,
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
              // CONTRAENTREGA nunca pasa por aquí (no llega a PAGO_ENVIADO),
              // pero el tipo lo exige: mapear a EFECTIVO por si acaso.
              metodoPago:
                pedido.metodoPago === MetodoPagoMarketplace.CONTRAENTREGA
                  ? MetodoPagoVenta.EFECTIVO
                  : ((pedido.metodoPago as unknown as MetodoPagoVenta) ??
                    MetodoPagoVenta.TRANSFERENCIA),
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
   * Confirmación AUTOMÁTICA del pago vía api-yape (webhook payment.confirmed
   * con reference `pedido:<id>`): valida el pago sin intervención de la
   * empresa — el pedido salta directo a PAGO_VALIDADO (sin foto ni validación
   * manual). Idempotente: si el pedido ya avanzó o se canceló, no hace nada.
   *
   * El ingreso se registra SIEMPRE en la Caja Central (tesorería) de la
   * primera sede activa — a diferencia del flujo manual (best-effort en la
   * caja del validador), aquí no hay usuario con caja abierta.
   */
  /**
   * Sede a la que se atribuye el dinero/venta de un pedido, con el MISMO
   * criterio en el ingreso del pago y en la venta interna del envío:
   * 1) sede del stock del primer detalle que tenga stock (de ahí saldrá la
   *    mercadería), 2) sede de retiro, 3) primera sede activa (orden estable
   *    por creación — findFirst sin orderBy devolvía una sede arbitraria).
   */
  private async resolverSedeParaPedido(
    empresaId: string,
    pedidoId: string,
    sedeRetiroId?: string | null,
  ): Promise<string | null> {
    const detalles = await this.prisma.pedidoMarketplaceDetalle.findMany({
      where: { pedidoId },
      select: { productoId: true, varianteId: true },
    });
    for (const d of detalles) {
      const stock = await this.prisma.productoStock.findFirst({
        where: {
          empresaId,
          productoId: d.varianteId ? null : d.productoId,
          varianteId: d.varianteId ?? null,
        },
        select: { sedeId: true },
      });
      if (stock?.sedeId) return stock.sedeId;
    }
    if (sedeRetiroId) return sedeRetiroId;
    const sede = await this.prisma.sede.findFirst({
      where: { empresaId, isActive: true },
      orderBy: { creadoEn: 'asc' },
      select: { id: true },
    });
    return sede?.id ?? null;
  }

  async confirmarPagoYapeAutomatico(
    empresaId: string,
    pedidoId: string,
    datos: { metodo: 'YAPE' | 'PLIN'; referencia?: string },
  ) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, empresaId },
    });
    if (!pedido) return { accion: 'pedido-no-encontrado' };

    const pagables: EstadoPedidoMarketplace[] = [
      EstadoPedidoMarketplace.PENDIENTE_PAGO,
      EstadoPedidoMarketplace.PAGO_ENVIADO,
      EstadoPedidoMarketplace.PAGO_RECHAZADO,
    ];
    if (!pagables.includes(pedido.estado)) {
      // Ya validado (webhook duplicado) o cancelado/avanzado (webhook tardío).
      return {
        accion:
          pedido.estado === EstadoPedidoMarketplace.CANCELADO
            ? 'pedido-cancelado'
            : 'ya-validado',
      };
    }

    await this.prisma.pedidoMarketplace.update({
      where: { id: pedido.id },
      data: {
        estado: EstadoPedidoMarketplace.PAGO_VALIDADO,
        pagoValidadoEn: new Date(),
        metodoPago: datos.metodo as any,
        transaccionExternaId: datos.referencia ?? null,
      },
    });

    // Ingreso a Caja Central (nunca se pierde), a nombre de un admin.
    // SEDE = el MISMO criterio que usará la venta interna al ENVIAR (sede del
    // stock que saldrá → sede de retiro → primera activa determinista). Antes
    // se usaba findFirst sin orderBy (sede arbitraria): el ingreso caía en la
    // bóveda de una sede y el reverso de una anulación salía de la bóveda de
    // la sede de la venta → descuadre cruzado entre bóvedas (caso real:
    // PED-00016 ingreso en Chiclayo, venta en Principal).
    try {
      const [sedeIngresoId, admin] = await Promise.all([
        this.resolverSedeParaPedido(empresaId, pedido.id, pedido.sedeRetiroId),
        this.prisma.empresaUsuarioRol.findFirst({
          where: { empresaId, rol: 'EMPRESA_ADMIN', isActive: true },
          select: { usuarioId: true },
        }),
      ]);
      if (sedeIngresoId && admin) {
        await this.prisma.$transaction(async (tx) => {
          const central = await this.cajaService.getOrCreateCajaCentral(
            empresaId,
            sedeIngresoId,
            tx,
          );
          await this.cajaService.crearMovimientoAutomatico(
            empresaId,
            central.id,
            {
              tipo: 'INGRESO' as any,
              categoria: 'PEDIDO_MARKETPLACE' as any,
              metodoPago: datos.metodo as any,
              monto: Number(pedido.total),
              descripcion: `Pedido marketplace ${pedido.codigo} (Yape automático)`,
              pedidoMarketplaceId: pedido.id,
              registradoPorId: admin.usuarioId,
              metadata: { automatico: true, fuente: 'webhook-yape' },
            },
            tx,
          );
        });
      } else {
        this.logger.warn(
          `Pago Yape automático de pedido ${pedido.codigo}: sin sede activa o admin — ingreso a caja NO registrado`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Error registrando ingreso de pedido ${pedido.codigo}: ${e?.message ?? e}`,
      );
    }

    // Notificar comprador + admins de la empresa (best-effort).
    try {
      await this.notificacionService.enviarAUsuario(
        pedido.compradorId,
        'Pago confirmado',
        `Tu pago ${datos.metodo} del pedido #${pedido.codigo} fue confirmado automáticamente. Pronto prepararemos tu pedido.`,
        {
          tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
          empresaId,
          data: { pedidoId: pedido.id },
          guardar: true,
        },
      );
    } catch (_) {}
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'VENDEDOR'] },
          isActive: true,
        },
        select: { usuarioId: true },
      });
      const adminIds = [...new Set(admins.map((a) => a.usuarioId))];
      if (adminIds.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          adminIds,
          'Pedido pagado',
          `El pedido #${pedido.codigo} fue pagado con ${datos.metodo} (confirmación automática por S/ ${Number(pedido.total).toFixed(2)})`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId,
            data: { pedidoId: pedido.id },
          },
        );
      }
    } catch (_) {}

    return { accion: 'pago-validado', pedidoId: pedido.id };
  }

  /**
   * Al ENTREGAR un pedido CONTRAENTREGA el repartidor/tienda cobró el efectivo
   * → saldar la venta ligada (PagoVenta EFECTIVO + PAGADA_COMPLETA) y registrar
   * el ingreso en la Caja Central. Idempotente por estado de la venta.
   * Best-effort: nunca bloquea la entrega.
   */
  async registrarCobroContraentrega(empresaId: string, pedidoId: string) {
    try {
      const pedido = await this.prisma.pedidoMarketplace.findFirst({
        where: { id: pedidoId, empresaId },
        select: {
          id: true,
          codigo: true,
          total: true,
          metodoPago: true,
          ventaId: true,
        },
      });
      if (!pedido || pedido.metodoPago !== MetodoPagoMarketplace.CONTRAENTREGA) {
        return;
      }

      // Saldar la venta interna creada al ENVIAR (nació CONFIRMADA sin pagos).
      if (pedido.ventaId) {
        const venta = await this.prisma.venta.findFirst({
          where: { id: pedido.ventaId, empresaId },
          select: { id: true, estado: true },
        });
        if (venta?.estado === EstadoVenta.PAGADA_COMPLETA) {
          return; // cobro ya registrado (idempotencia)
        }
        if (venta) {
          await this.prisma.venta.update({
            where: { id: venta.id },
            data: {
              estado: EstadoVenta.PAGADA_COMPLETA,
              pagos: {
                create: {
                  metodoPago: MetodoPagoVenta.EFECTIVO,
                  monto: pedido.total,
                  referencia: pedido.codigo,
                },
              },
            },
          });
        }
      }

      // Ingreso del efectivo a la Caja Central (a nombre de un admin).
      const [sede, admin] = await Promise.all([
        this.prisma.sede.findFirst({
          where: { empresaId, isActive: true },
          select: { id: true },
        }),
        this.prisma.empresaUsuarioRol.findFirst({
          where: { empresaId, rol: 'EMPRESA_ADMIN', isActive: true },
          select: { usuarioId: true },
        }),
      ]);
      if (sede && admin) {
        await this.prisma.$transaction(async (tx) => {
          const central = await this.cajaService.getOrCreateCajaCentral(
            empresaId,
            sede.id,
            tx,
          );
          await this.cajaService.crearMovimientoAutomatico(
            empresaId,
            central.id,
            {
              tipo: 'INGRESO' as any,
              categoria: 'PEDIDO_MARKETPLACE' as any,
              metodoPago: MetodoPagoVenta.EFECTIVO,
              monto: Number(pedido.total),
              descripcion: `Pedido marketplace ${pedido.codigo} (contraentrega)`,
              pedidoMarketplaceId: pedido.id,
              registradoPorId: admin.usuarioId,
              metadata: { contraentrega: true },
            },
            tx,
          );
        });
      } else {
        this.logger.warn(
          `Cobro contraentrega de pedido ${pedido.codigo}: sin sede activa o admin — ingreso a caja NO registrado`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Error registrando cobro contraentrega del pedido ${pedidoId}: ${e?.message ?? e}`,
      );
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
            // Orden estable: mismo fallback que el ingreso del pago (sin
            // orderBy, findFirst devolvía una sede arbitraria y el dinero
            // podía entrar a una bóveda distinta de la de la venta).
            orderBy: { creadoEn: 'asc' },
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
          // CONTRAENTREGA no: el cobro será EFECTIVO al entregar → la venta
          // nace CONFIRMADA sin pagos y se salda al pasar a ENTREGADO.
          const esContraentrega =
            pedido.metodoPago === MetodoPagoMarketplace.CONTRAENTREGA;
          const metodoPagoVenta: MetodoPagoVenta = esContraentrega
            ? MetodoPagoVenta.EFECTIVO
            : ((pedido.metodoPago as unknown as MetodoPagoVenta) ??
              MetodoPagoVenta.TRANSFERENCIA);

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
              estado: esContraentrega
                ? EstadoVenta.CONFIRMADA
                : EstadoVenta.PAGADA_COMPLETA,
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
              // Contraentrega: sin pago aún — se registra al ENTREGADO.
              ...(esContraentrega
                ? {}
                : {
                    pagos: {
                      create: {
                        metodoPago: metodoPagoVenta,
                        monto: pedido.total,
                        referencia: pedido.transaccionExternaId ?? pedido.codigo,
                      },
                    },
                  }),
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

    // Contraentrega: al ENTREGAR se cobró el efectivo → saldar venta + caja.
    if (dto.estado === EstadoPedidoMarketplace.ENTREGADO) {
      await this.registrarCobroContraentrega(empresaId, pedidoId);
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
    const [pendientesPago, pagoEnviado, pagoValidado, enPreparacion, enviados, totalMes] =
      await Promise.all([
        this.prisma.pedidoMarketplace.count({
          where: { empresaId, estado: EstadoPedidoMarketplace.PENDIENTE_PAGO },
        }),
        this.prisma.pedidoMarketplace.count({
          where: { empresaId, estado: EstadoPedidoMarketplace.PAGO_ENVIADO },
        }),
        this.prisma.pedidoMarketplace.count({
          where: { empresaId, estado: EstadoPedidoMarketplace.PAGO_VALIDADO },
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
      pagoValidado,
      enPreparacion,
      enviados,
      totalMes,
      // Requieren acción de la empresa: validar el comprobante (PAGO_ENVIADO)
      // o preparar el pedido ya pagado (PAGO_VALIDADO — con Yape automático y
      // contraentrega los pedidos llegan directo a este estado).
      requierenAccion: pagoEnviado + pagoValidado,
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
        permiteContraentrega: true,
      },
    });

    return {
      envioGratisDesde: empresa?.envioGratisDesde ? Number(empresa.envioGratisDesde) : null,
      permiteRetiroTienda: empresa?.permiteRetiroTienda ?? false,
      permiteContraentrega: empresa?.permiteContraentrega ?? false,
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
        ...(dto.permiteContraentrega !== undefined && { permiteContraentrega: dto.permiteContraentrega }),
      },
    });

    return this.getConfiguracionEnvio(empresaId);
  }
}
