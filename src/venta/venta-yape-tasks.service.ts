import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EstadoVenta, MetodoPagoVenta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { VentaService } from './venta.service';

/**
 * TTL de ventas Yape/Plin abandonadas.
 *
 * El flujo Yape crea la venta CONFIRMADA (pendiente) y le descuenta el stock
 * de inmediato; luego api-yape confirma el pago vía webhook → PAGADA_COMPLETA.
 * Si el cliente no llega a pagar (cierra la app, no confirma, el webhook nunca
 * llega), la venta quedaría CONFIRMADA para siempre con el stock ya descontado
 * → inventario "vendido" a una venta fantasma.
 *
 * Este cron anula automáticamente esas ventas pasados TTL_MINUTOS: devuelve el
 * stock, revierte la cotización origen a APROBADA (re-cobrable) y limpia la
 * venta huérfana, sin intervención del cajero.
 *
 * Se reusa VentaService.anular con `soloSiPendienteSinPagos` para cerrar la
 * carrera con un webhook que pague la venta justo antes de anularla.
 */
@Injectable()
export class VentaYapeTasksService {
  private readonly logger: AppLoggerService;

  /** Ventana de gracia antes de dar por abandonado el cobro Yape. El charge
   * de api-yape expira mucho antes; 30 min es un colchón holgado. */
  private static readonly TTL_MINUTOS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ventaService: VentaService,
    private readonly realtime: RealtimeInvalidationService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(VentaYapeTasksService.name);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expirarVentasYapePendientes() {
    try {
      const limite = new Date(
        Date.now() - VentaYapeTasksService.TTL_MINUTOS * 60_000,
      );

      // Candidatas: venta Yape/Plin que sigue pendiente (CONFIRMADA), sin
      // pagos, no a crédito, y más vieja que el TTL.
      const ventas = await this.prisma.venta.findMany({
        where: {
          estado: EstadoVenta.CONFIRMADA,
          esCredito: false,
          metodoPago: { in: [MetodoPagoVenta.YAPE, MetodoPagoVenta.PLIN] },
          creadoEn: { lt: limite },
          pagos: { none: {} },
        },
        select: { id: true, empresaId: true, sedeId: true, codigo: true },
        take: 100, // batch — el resto en la próxima corrida
      });

      if (ventas.length === 0) return;

      this.logger.info(
        `[CRON] Expirando ${ventas.length} venta(s) Yape/Plin pendiente(s) sin pago`,
      );

      const empresasAfectadas = new Map<string, Set<string>>(); // empresaId → set<sedeId>

      for (const v of ventas) {
        try {
          // anular sin dto → no setea anuladoPorId/autorizadoPorId (FK a
          // Usuario; aquí es el sistema). El guard cierra la carrera con el
          // webhook. Revierte stock + cotización + órdenes.
          await this.ventaService.anular(
            v.id,
            v.empresaId,
            'SYSTEM-YAPE-TTL',
            undefined,
            { soloSiPendienteSinPagos: true },
          );
          // Sellar el motivo (anular sin dto no lo registra).
          await this.prisma.venta.update({
            where: { id: v.id },
            data: {
              motivoAnulacion:
                'Expiración automática: pago Yape/Plin no confirmado',
              fechaAnulacion: new Date(),
            },
          });
          const sedes = empresasAfectadas.get(v.empresaId) ?? new Set();
          sedes.add(v.sedeId);
          empresasAfectadas.set(v.empresaId, sedes);
        } catch (err) {
          // La venta se cobró/resolvió entre la selección y la anulación, o
          // cualquier otro error: solo lo logeamos y seguimos.
          this.logger.warn(
            `[CRON] No se anuló la venta ${v.codigo}: ${(err as Error).message}`,
          );
        }
      }

      // Avisar a los devices conectados para refrescar stock.
      for (const [empresaId, sedes] of empresasAfectadas) {
        for (const sedeId of sedes) {
          this.realtime.notifyStockCambiado({ empresaId, sedeId });
        }
      }
    } catch (err) {
      this.logger.error(
        `[CRON] expirarVentasYapePendientes falló: ${(err as Error).message}`,
      );
    }
  }
}
