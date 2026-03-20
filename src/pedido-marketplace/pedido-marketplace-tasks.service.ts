import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { EstadoPedidoMarketplace, TipoNotificacion } from '@prisma/client';

@Injectable()
export class PedidoMarketplaceTasksService {
  private readonly logger: AppLoggerService;

  // Configuración de tiempos
  private readonly HORAS_EXPIRACION_SIN_PAGO = 24;
  private readonly HORAS_EXPIRACION_RECHAZADO = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(PedidoMarketplaceTasksService.name);
  }

  /**
   * Cada hora: Auto-cancelar pedidos PENDIENTE_PAGO después de 24 horas
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cancelarPedidosSinPago() {
    try {
      const fechaLimite = new Date();
      fechaLimite.setHours(fechaLimite.getHours() - this.HORAS_EXPIRACION_SIN_PAGO);

      const pedidos = await this.prisma.pedidoMarketplace.findMany({
        where: {
          estado: EstadoPedidoMarketplace.PENDIENTE_PAGO,
          creadoEn: { lt: fechaLimite },
        },
        include: { detalles: true },
      });

      for (const pedido of pedidos) {
        await this._cancelarYLiberarStock(
          pedido,
          `Cancelado automáticamente: sin pago después de ${this.HORAS_EXPIRACION_SIN_PAGO} horas`,
        );

        // Notificar al cliente
        try {
          await this.notificacionService.enviarAUsuario(
            pedido.compradorId,
            'Pedido cancelado',
            `Tu pedido #${pedido.codigo} fue cancelado por no recibir el comprobante de pago a tiempo.`,
            {
              tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
              empresaId: pedido.empresaId,
              data: { pedidoId: pedido.id },
              guardar: true,
            },
          );
        } catch (_) {}
      }

      if (pedidos.length > 0) {
        this.logger.info(`${pedidos.length} pedidos sin pago cancelados`);
      }
    } catch (error) {
      this.logger.error(`Error cancelando pedidos sin pago: ${error.message}`);
    }
  }

  /**
   * Cada 30 min: Auto-cancelar pedidos PAGO_RECHAZADO después de 2 horas
   */
  @Cron('*/30 * * * *')
  async cancelarPedidosRechazados() {
    try {
      const fechaLimite = new Date();
      fechaLimite.setHours(fechaLimite.getHours() - this.HORAS_EXPIRACION_RECHAZADO);

      const pedidos = await this.prisma.pedidoMarketplace.findMany({
        where: {
          estado: EstadoPedidoMarketplace.PAGO_RECHAZADO,
          actualizadoEn: { lt: fechaLimite },
        },
        include: { detalles: true },
      });

      for (const pedido of pedidos) {
        await this._cancelarYLiberarStock(
          pedido,
          `Cancelado automáticamente: comprobante rechazado sin reenvío después de ${this.HORAS_EXPIRACION_RECHAZADO} horas`,
        );

        try {
          await this.notificacionService.enviarAUsuario(
            pedido.compradorId,
            'Pedido cancelado',
            `Tu pedido #${pedido.codigo} fue cancelado porque no se recibió un nuevo comprobante válido a tiempo.`,
            {
              tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
              empresaId: pedido.empresaId,
              data: { pedidoId: pedido.id },
              guardar: true,
            },
          );
        } catch (_) {}
      }

      if (pedidos.length > 0) {
        this.logger.info(`${pedidos.length} pedidos rechazados cancelados`);
      }
    } catch (error) {
      this.logger.error(`Error cancelando pedidos rechazados: ${error.message}`);
    }
  }

  /**
   * Cada 5 min: Recordar validación de pago a los 15 y 30 min
   * Solo envía 2 recordatorios por pedido, no spam
   */
  @Cron('*/5 * * * *')
  async recordarValidacionPago() {
    try {
      const now = new Date();
      const hace15min = new Date(now.getTime() - 15 * 60 * 1000);
      const hace20min = new Date(now.getTime() - 20 * 60 * 1000);
      const hace30min = new Date(now.getTime() - 30 * 60 * 1000);
      const hace35min = new Date(now.getTime() - 35 * 60 * 1000);

      // Pedidos con comprobante enviado hace 15-20 min (primer recordatorio)
      // o hace 30-35 min (segundo recordatorio)
      const pedidos = await this.prisma.pedidoMarketplace.findMany({
        where: {
          estado: EstadoPedidoMarketplace.PAGO_ENVIADO,
          OR: [
            { pagoEnviadoEn: { gte: hace20min, lte: hace15min } },
            { pagoEnviadoEn: { gte: hace35min, lte: hace30min } },
          ],
        },
        select: {
          id: true,
          codigo: true,
          empresaId: true,
          nombreComprador: true,
          pagoEnviadoEn: true,
        },
      });

      if (pedidos.length === 0) return;

      // Agrupar por empresa
      const porEmpresa = new Map<string, typeof pedidos>();
      for (const p of pedidos) {
        if (!porEmpresa.has(p.empresaId)) porEmpresa.set(p.empresaId, []);
        porEmpresa.get(p.empresaId)!.push(p);
      }

      for (const [empresaId, pedidosEmpresa] of porEmpresa) {
        const admins = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            empresaId,
            rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CAJERO'] },
            isActive: true,
          },
          select: { usuarioId: true },
        });

        const adminIds = [...new Set(admins.map((a) => a.usuarioId))];
        if (adminIds.length === 0) continue;

        const count = pedidosEmpresa.length;
        const plural = count > 1;

        await this.notificacionService.enviarAUsuarios(
          adminIds,
          `Recordatorio: ${count} pago${plural ? 's' : ''} por validar`,
          plural
            ? `Tienes ${count} pedidos con comprobante de pago esperando verificación.`
            : `El pedido #${pedidosEmpresa[0].codigo} de ${pedidosEmpresa[0].nombreComprador} espera validación de pago.`,
          {
            tipo: TipoNotificacion.PEDIDO_MARKETPLACE,
            empresaId,
          },
        );
      }

      this.logger.info(`Recordatorios enviados para ${pedidos.length} pedidos`);
    } catch (error) {
      this.logger.error(`Error enviando recordatorios: ${error.message}`);
    }
  }

  /**
   * Helper: cancelar pedido y liberar stock en transacción
   */
  private async _cancelarYLiberarStock(pedido: any, motivo: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
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
          where: { id: pedido.id },
          data: {
            estado: EstadoPedidoMarketplace.CANCELADO,
            motivoRechazo: motivo,
          },
        });
      });

      this.logger.info(`Pedido ${pedido.codigo} cancelado: ${motivo}`);
    } catch (error) {
      this.logger.error(`Error cancelando pedido ${pedido.codigo}: ${error.message}`);
    }
  }
}
