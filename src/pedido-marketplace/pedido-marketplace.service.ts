import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { StorageService } from '../storage/storage.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import { PedidoMarketplaceEmpresaService } from './pedido-marketplace-empresa.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CarritoService } from './carrito.service';
import { siguienteContador } from '../configuracion-codigos/contador-codigo.util';
import {
  CaracteristicaPremium,
  EstadoPedidoMarketplace,
  MetodoPagoMarketplace,
  TipoNotificacion,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PedidoMarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carritoService: CarritoService,
    private readonly codigosService: ConfiguracionCodigosService,
    private readonly notificacionService: NotificacionService,
    private readonly storageService: StorageService,
    private readonly integracionYape: IntegracionYapeService,
    private readonly caracteristicaEmpresa: CaracteristicaEmpresaService,
    private readonly pedidoEmpresaService: PedidoMarketplaceEmpresaService,
  ) {}

  /** Reference del charge api-yape de un pedido (el webhook rutea por prefijo). */
  static referenciaYape(pedidoId: string) {
    return `pedido:${pedidoId}`;
  }

  /**
   * Inicia el cobro Yape/Plin AUTOMÁTICO de un pedido (api-yape): crea un
   * charge con reference `pedido:<id>` y devuelve el monto exacto (payAmount,
   * céntimos únicos) + QR del comercio. Cuando el comprador yapea, api-yape
   * matchea la notificación y el webhook valida el pago SOLO (el pedido pasa a
   * PAGO_VALIDADO sin foto ni validación manual).
   *
   * Devuelve { habilitado:false } si la empresa no tiene la característica
   * premium YAPE_QR, la integración está apagada, el total excede el límite por
   * transacción o api-yape no responde → la app cae al flujo manual (foto).
   */
  async cobroYapePedido(usuarioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, compradorId: usuarioId },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const pagable =
      pedido.estado === EstadoPedidoMarketplace.PENDIENTE_PAGO ||
      pedido.estado === EstadoPedidoMarketplace.PAGO_RECHAZADO;
    if (!pagable) {
      throw new BadRequestException('Este pedido no está pendiente de pago');
    }

    const total = Number(pedido.total);

    // QR estático del comercio: se devuelve también en modo manual (el
    // comprador puede escanearlo y subir su comprobante).
    const cfgQr = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId: pedido.empresaId },
      select: { qrYapeUrl: true, qrPlinUrl: true },
    });
    const qr = {
      qrYapeUrl: cfgQr?.qrYapeUrl ?? null,
      qrPlinUrl: cfgQr?.qrPlinUrl ?? null,
    };

    // Gate premium de la EMPRESA del pedido.
    const yapeHabilitado = await this.caracteristicaEmpresa.estaHabilitada(
      pedido.empresaId,
      CaracteristicaPremium.YAPE_QR,
    );
    if (!yapeHabilitado) return { habilitado: false as const, total, ...qr };

    // El marketplace cobra en UN solo pago → si el total excede el límite Yape
    // por transacción de la empresa, no se ofrece el cobro automático.
    const cfgYape = await this.prisma.integracionYape.findUnique({
      where: { empresaId: pedido.empresaId },
      select: { habilitado: true, montoMaxPorTransaccion: true, celular: true },
    });
    if (!cfgYape?.habilitado || total > Number(cfgYape.montoMaxPorTransaccion)) {
      return { habilitado: false as const, total, ...qr };
    }

    // Cancel-then-create: si el comprador reabre la hoja no se acumulan charges
    // pendientes del mismo pedido (cada create genera un payAmount distinto).
    const reference = PedidoMarketplaceService.referenciaYape(pedido.id);
    try {
      await this.integracionYape.cancelarCobro({
        empresaId: pedido.empresaId,
        ventaId: reference,
      });
    } catch (_) {}

    const cobro = await this.integracionYape.crearCobro({
      empresaId: pedido.empresaId,
      ventaId: reference,
      monto: total,
    });
    if (!cobro) return { habilitado: false as const, total, ...qr };

    return {
      habilitado: true as const,
      payAmount: cobro.payAmount,
      chargeId: cobro.chargeId,
      total,
      // Número Yape del comercio: la app lo COPIA al portapapeles (no lo
      // muestra) para que el comprador pague desde su app Yape.
      celular: cfgYape.celular ?? null,
      ...qr,
    };
  }

  /**
   * Checkout: crear pedidos desde el carrito (1 por empresa)
   *
   * Seguridad de precios: el `precioUnitario` y `subtotal` de cada item se
   * toman de `carritoService.getCarrito()`, que recalcula desde el backend
   * aplicando `min(precioBase, precioOferta activa, precio con PrecioNivel)`.
   * El cliente NUNCA envía precios al checkout — el DTO solo trae
   * dirección/método de pago/notas. No hay vector de manipulación.
   */
  async checkout(usuarioId: string, dto: CheckoutDto) {
    // 1. Obtener carrito enriquecido (precios forzados por backend)
    const carrito = await this.carritoService.getCarrito(usuarioId);

    if (carrito.totalItems === 0) {
      throw new BadRequestException('El carrito está vacío');
    }

    // Verificar que todos los items estén disponibles
    for (const grupo of carrito.empresas) {
      for (const item of grupo.items) {
        if (!item.disponible) {
          throw new BadRequestException(
            `"${item.productoNombre}" no está disponible o no tiene stock suficiente`,
          );
        }
      }
    }

    // CONTRAENTREGA: opt-in por empresa. Todas las empresas del carrito deben
    // permitirlo (el método de pago es único para todo el checkout).
    const esContraentrega =
      dto.metodoPago === MetodoPagoMarketplace.CONTRAENTREGA;
    if (esContraentrega) {
      const empresas = await this.prisma.empresa.findMany({
        where: { id: { in: carrito.empresas.map((g: any) => g.empresa.id) } },
        select: { id: true, nombre: true, permiteContraentrega: true },
      });
      const sinContraentrega = empresas.filter((e) => !e.permiteContraentrega);
      if (sinContraentrega.length > 0) {
        throw new BadRequestException(
          `${sinContraentrega.map((e) => e.nombre).join(', ')} no acepta pago contraentrega. Elige otro método de pago.`,
        );
      }
    }

    // 2. Resolver dirección de envío
    let direccionData: any = {
      direccionEnvio: dto.direccionEnvio ?? null,
      referenciaEnvio: dto.referenciaEnvio ?? null,
      distritoEnvio: dto.distritoEnvio ?? null,
      provinciaEnvio: dto.provinciaEnvio ?? null,
      departamentoEnvio: dto.departamentoEnvio ?? null,
      coordenadasEnvio: null,
    };

    if (dto.direccionEnvioId) {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { personaId: true },
      });

      const direccion = await this.prisma.direccionPersona.findFirst({
        where: { id: dto.direccionEnvioId, personaId: usuario.personaId },
      });

      if (direccion) {
        direccionData = {
          direccionEnvio: direccion.direccion,
          referenciaEnvio: direccion.referencia,
          distritoEnvio: direccion.distrito,
          provinciaEnvio: direccion.provincia,
          departamentoEnvio: direccion.departamento,
          coordenadasEnvio: direccion.coordenadas,
        };
      }
    }

    // 3. Obtener datos del comprador
    const comprador = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { persona: true },
    });

    const nombreComprador = `${comprador.persona.nombres} ${comprador.persona.apellidos}`.trim();

    // 4. Crear pedidos (1 por empresa) en transacción
    const pedidosCreados = [];

    for (const grupo of carrito.empresas) {
      // Determinar tipo de entrega y costo para esta empresa
      const entregaConfig = dto.entregaPorEmpresa?.find(
        (e) => e.empresaId === grupo.empresa.id,
      );
      const tipoEntrega = entregaConfig?.tipoEntrega ?? 'ENVIO_DOMICILIO';
      const sedeRetiroId = entregaConfig?.sedeRetiroId ?? null;

      const pedido = await this.prisma.$transaction(async (tx) => {
        // Re-verificar y reservar stock dentro de la transacción (previene race conditions)
        for (const item of grupo.items as any[]) {
          const stock = await tx.productoStock.findFirst({
            where: {
              empresaId: grupo.empresa.id,
              productoId: item.varianteId ? null : item.productoId,
              varianteId: item.varianteId ?? null,
            },
          });

          if (!stock) {
            throw new BadRequestException(`Sin stock para "${item.productoNombre}"`);
          }

          const disponible = stock.stockActual - stock.stockReservado
            - stock.stockReservadoVenta - stock.stockDanado - stock.stockEnGarantia;

          if (disponible < item.cantidad) {
            throw new BadRequestException(
              `Stock insuficiente para "${item.productoNombre}". Disponible: ${disponible}, solicitado: ${item.cantidad}`,
            );
          }

          // Reservar stock
          await tx.productoStock.update({
            where: { id: stock.id },
            data: { stockReservadoVenta: { increment: item.cantidad } },
          });
        }

        // Generar código
        const codigo = await this._generarCodigoPedido(tx, grupo.empresa.id);

        // Calcular totales
        const subtotal = grupo.items.reduce(
          (sum: number, i: any) => sum + i.subtotal, 0,
        );

        // Crear pedido
        const nuevoPedido = await tx.pedidoMarketplace.create({
          data: {
            codigo,
            compradorId: usuarioId,
            empresaId: grupo.empresa.id,
            nombreComprador,
            emailComprador: comprador.email,
            telefonoComprador: comprador.persona.telefono,
            ...(tipoEntrega === 'ENVIO_DOMICILIO' ? direccionData : {}),
            subtotal,
            costoEnvio: 0,
            total: subtotal,
            moneda: 'PEN',
            // Contraentrega: no hay pago que validar → nace listo para
            // preparar (y el cron TTL de PENDIENTE_PAGO no lo expira).
            estado: esContraentrega
              ? EstadoPedidoMarketplace.PAGO_VALIDADO
              : EstadoPedidoMarketplace.PENDIENTE_PAGO,
            tipoEntrega,
            ...(sedeRetiroId && { sedeRetiroId }),
            metodoPago: dto.metodoPago,
            notasComprador: dto.notasComprador,
            detalles: {
              create: (grupo.items as any[]).map((item: any) => ({
                productoId: item.productoId,
                varianteId: item.varianteId,
                descripcion: item.varianteNombre
                  ? `${item.productoNombre} - ${item.varianteNombre}`
                  : item.productoNombre,
                cantidad: item.cantidad,
                precioUnitario: item.precioUnitario,
                subtotal: item.subtotal,
                imagenUrl: item.imagenUrl,
              })),
            },
          },
          include: {
            detalles: true,
            empresa: { select: { id: true, nombre: true } },
          },
        });

        return nuevoPedido;
      });

      pedidosCreados.push(pedido);

      // Notificar a la empresa (fuera de la transacción)
      try {
        // Buscar admins de la empresa para notificar
        const admins = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            empresaId: grupo.empresa.id,
            rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'VENDEDOR'] },
            isActive: true,
          },
          select: { usuarioId: true },
        });

        const adminIds = [...new Set(admins.map((a) => a.usuarioId))];

        if (adminIds.length > 0) {
          await this.notificacionService.enviarAUsuarios(
            adminIds,
            'Nuevo pedido recibido',
            `Pedido #${pedido.codigo} de ${nombreComprador} por PEN ${Number(pedido.total).toFixed(2)}`,
            {
              tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
              empresaId: grupo.empresa.id,
              data: { pedidoId: pedido.id },
  
            },
          );
        }
      } catch (_) {
        // No bloquear si falla la notificación
      }
    }

    // 5. Vaciar carrito
    await this.carritoService.vaciarCarrito(usuarioId);

    return {
      pedidos: pedidosCreados,
      totalPedidos: pedidosCreados.length,
      message: pedidosCreados.length === 1
        ? 'Pedido creado exitosamente'
        : `${pedidosCreados.length} pedidos creados exitosamente`,
    };
  }

  /**
   * Listar pedidos del comprador
   */
  async misPedidos(
    usuarioId: string,
    estado?: EstadoPedidoMarketplace,
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.PedidoMarketplaceWhereInput = { compradorId: usuarioId };
    if (estado) where.estado = estado;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.pedidoMarketplace.findMany({
        where,
        include: {
          empresa: { select: { id: true, nombre: true, logo: true, subdominio: true } },
          detalles: {
            select: {
              id: true,
              productoId: true,
              varianteId: true,
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
   * Detalle de un pedido del comprador
   */
  async miPedidoDetalle(usuarioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, compradorId: usuarioId },
      include: {
        empresa: { select: { id: true, nombre: true, logo: true, subdominio: true } },
        detalles: true,
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    // ¿La empresa puede cobrar con Yape AUTOMÁTICO este pedido? Mismo gate
    // que el cobro (feature premium YAPE_QR + integración habilitada +
    // monto dentro del límite). El app solo muestra el botón "Pagar con
    // Yape" si esto es true — igual que Venta Rápida; sin api-yape el
    // comprador ve únicamente el flujo manual (subir captura del pago).
    let yapeAutomaticoDisponible = false;
    const estadosPagables: EstadoPedidoMarketplace[] = [
      EstadoPedidoMarketplace.PENDIENTE_PAGO,
      EstadoPedidoMarketplace.PAGO_ENVIADO,
      EstadoPedidoMarketplace.PAGO_RECHAZADO,
    ];
    if (estadosPagables.includes(pedido.estado)) {
      try {
        const conFeature = await this.caracteristicaEmpresa.estaHabilitada(
          pedido.empresaId,
          CaracteristicaPremium.YAPE_QR,
        );
        if (conFeature) {
          const cfg = await this.prisma.integracionYape.findUnique({
            where: { empresaId: pedido.empresaId },
            select: { habilitado: true, montoMaxPorTransaccion: true },
          });
          yapeAutomaticoDisponible =
            !!cfg?.habilitado &&
            Number(pedido.total) <= Number(cfg.montoMaxPorTransaccion);
        }
      } catch {
        // Gate informativo: ante cualquier error se oculta el botón y el
        // comprador usa el flujo manual (nunca bloquea el detalle).
      }
    }

    return { ...pedido, yapeAutomaticoDisponible };
  }

  /**
   * Subir comprobante de pago (imagen Yape/Plin)
   */
  async subirComprobantePago(
    usuarioId: string,
    pedidoId: string,
    file: Express.Multer.File,
    metodoPago?: MetodoPagoMarketplace,
  ) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, compradorId: usuarioId },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const estadosPermitidos: EstadoPedidoMarketplace[] = [
      EstadoPedidoMarketplace.PENDIENTE_PAGO,
      EstadoPedidoMarketplace.PAGO_RECHAZADO,
      EstadoPedidoMarketplace.PAGO_ENVIADO, // Permitir resubir comprobante
    ];

    if (!estadosPermitidos.includes(pedido.estado)) {
      throw new BadRequestException('Este pedido no acepta comprobantes de pago en su estado actual');
    }

    // Subir imagen usando StorageService
    const archivo = await this.storageService.uploadArchivo({
      file,
      empresaId: pedido.empresaId,
      entidadTipo: 'PEDIDO_MARKETPLACE',
      entidadId: pedidoId,
      categoria: 'PRINCIPAL',
      subidoPor: usuarioId,
    });

    // Actualizar pedido
    await this.prisma.pedidoMarketplace.update({
      where: { id: pedidoId },
      data: {
        comprobantePagoUrl: archivo.url,
        estado: EstadoPedidoMarketplace.PAGO_ENVIADO,
        pagoEnviadoEn: new Date(),
        ...(metodoPago && { metodoPago }),
      },
    });

    // Notificar a la empresa
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId: pedido.empresaId,
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CAJERO'] },
          isActive: true,
        },
        select: { usuarioId: true },
      });

      const adminIds = [...new Set(admins.map((a) => a.usuarioId))];

      if (adminIds.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          adminIds,
          'Comprobante de pago recibido',
          `El comprador envió el comprobante para el pedido #${pedido.codigo}`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId: pedido.empresaId,
            data: { pedidoId: pedido.id },

          },
        );
      }
    } catch (_) {}

    return { message: 'Comprobante enviado exitosamente', comprobanteUrl: archivo.url };
  }

  /**
   * Cancelar pedido y liberar stock reservado
   */
  async cancelarPedido(usuarioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, compradorId: usuarioId },
      include: { detalles: true },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const cancelables: EstadoPedidoMarketplace[] = [
      EstadoPedidoMarketplace.PENDIENTE_PAGO,
      EstadoPedidoMarketplace.PAGO_ENVIADO,
      EstadoPedidoMarketplace.PAGO_RECHAZADO,
    ];

    // Contraentrega nace PAGO_VALIDADO sin dinero de por medio → el comprador
    // puede cancelar mientras la empresa no empiece a preparar.
    const contraentregaSinPreparar =
      pedido.metodoPago === MetodoPagoMarketplace.CONTRAENTREGA &&
      pedido.estado === EstadoPedidoMarketplace.PAGO_VALIDADO;

    if (!cancelables.includes(pedido.estado) && !contraentregaSinPreparar) {
      throw new BadRequestException('Este pedido no se puede cancelar en su estado actual');
    }

    await this.prisma.$transaction(async (tx) => {
      // Liberar stock reservado
      for (const detalle of pedido.detalles) {
        const stock = await tx.productoStock.findFirst({
          where: {
            empresaId: pedido.empresaId,
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

      await tx.pedidoMarketplace.update({
        where: { id: pedidoId },
        data: { estado: EstadoPedidoMarketplace.CANCELADO },
      });
    });

    // Best-effort: liberar el charge Yape pendiente en api-yape (si había).
    // Si falla no importa: el charge expira solo por TTL y el webhook tardío
    // encuentra el pedido CANCELADO → se ignora.
    try {
      await this.integracionYape.cancelarCobro({
        empresaId: pedido.empresaId,
        ventaId: PedidoMarketplaceService.referenciaYape(pedido.id),
      });
    } catch (_) {}

    return { message: 'Pedido cancelado' };
  }

  /**
   * Confirmar recepción (cliente marca como entregado)
   */
  async confirmarRecepcion(usuarioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedidoMarketplace.findFirst({
      where: { id: pedidoId, compradorId: usuarioId },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (pedido.estado !== EstadoPedidoMarketplace.ENVIADO) {
      throw new BadRequestException('Solo se puede confirmar recepción de pedidos enviados');
    }

    await this.prisma.pedidoMarketplace.update({
      where: { id: pedidoId },
      data: {
        estado: EstadoPedidoMarketplace.ENTREGADO,
        entregadoEn: new Date(),
      },
    });

    // Contraentrega: al confirmar la entrega se cobró el efectivo → saldar
    // venta + registrar ingreso (no-op para los demás métodos).
    await this.pedidoEmpresaService.registrarCobroContraentrega(
      pedido.empresaId,
      pedido.id,
    );

    // Notificar a la empresa
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId: pedido.empresaId,
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN'] },
          isActive: true,
        },
        select: { usuarioId: true },
      });

      const adminIds = [...new Set(admins.map((a) => a.usuarioId))];

      if (adminIds.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          adminIds,
          'Pedido entregado',
          `El comprador confirmó la recepción del pedido #${pedido.codigo}`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId: pedido.empresaId,
            data: { pedidoId: pedido.id },

          },
        );
      }
    } catch (_) {}

    return { message: 'Recepción confirmada' };
  }

  // ─── Helper: generar código de pedido ───

  private async _generarCodigoPedido(
    tx: Prisma.TransactionClient,
    empresaId: string,
  ): Promise<string> {
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    const nuevoContador = await siguienteContador(tx, empresaId, 'PEDIDO_MARKETPLACE');

    const numero = nuevoContador
      .toString()
      .padStart(config.pedidoMarketplaceLongitud, '0');

    return `${config.pedidoMarketplaceCodigo}${config.pedidoMarketplaceSeparador}${numero}`;
  }
}
