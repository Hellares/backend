import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { StorageService } from '../storage/storage.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CarritoService } from './carrito.service';
import {
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
  ) {}

  /**
   * Checkout: crear pedidos desde el carrito (1 por empresa)
   */
  async checkout(usuarioId: string, dto: CheckoutDto) {
    // 1. Obtener carrito enriquecido
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
            estado: EstadoPedidoMarketplace.PENDIENTE_PAGO,
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

    return pedido;
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

    if (!cancelables.includes(pedido.estado)) {
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

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimoPedidoMarketplace: { increment: 1 },
      },
    });

    const numero = updated.ultimoPedidoMarketplace
      .toString()
      .padStart(config.pedidoMarketplaceLongitud, '0');

    return `${config.pedidoMarketplaceCodigo}${config.pedidoMarketplaceSeparador}${numero}`;
  }
}
