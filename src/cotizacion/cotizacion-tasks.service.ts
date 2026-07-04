import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EstadoCotizacion,
  Prisma,
  ReservaCotizacionEstado,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CotizacionService } from './cotizacion.service';

/**
 * Tareas programadas del módulo de cotizaciones.
 *
 * - Liberar reservas de stock de cotizaciones vencidas (cotizaciones
 *   con `fechaVencimiento < NOW()` y `reservaEstado = ACTIVA` en alguno
 *   de sus detalles).
 *
 * Corre 1 vez por hora — la granularidad fina permite reaccionar rápido
 * cuando una cotización vence (el cliente no llegó). Cada empresa tiene
 * pocas cotizaciones vencidas por día (decenas a lo sumo), así que el
 * cron es rapidísimo.
 */
@Injectable()
export class CotizacionTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly cotizacionService: CotizacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CotizacionTasksService.name);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expirarCotizacionesConReserva() {
    try {
      const ahora = new Date();

      // Buscar cotizaciones cuya `fechaVencimiento` ya pasó, sigan en
      // estado activo (BORRADOR / PENDIENTE / APROBADA), y tengan al
      // menos un detalle con reserva ACTIVA.
      const cotizaciones = await this.prisma.cotizacion.findMany({
        where: {
          fechaVencimiento: { lt: ahora },
          estado: {
            in: [
              EstadoCotizacion.BORRADOR,
              EstadoCotizacion.PENDIENTE,
              EstadoCotizacion.APROBADA,
            ],
          },
          detalles: {
            some: { reservaEstado: ReservaCotizacionEstado.ACTIVA },
          },
        },
        select: {
          id: true,
          empresaId: true,
          sedeId: true,
          codigo: true,
          movimientoCajaId: true,
          adelantoMonto: true,
          vendedorId: true,
        },
        take: 100, // batch — más en la próxima corrida si quedan
      });

      if (cotizaciones.length === 0) return;

      this.logger.info(
        `[CRON] Expirando ${cotizaciones.length} cotización(es) con reserva activa`,
      );

      const empresasAfectadas = new Map<string, Set<string>>(); // empresaId → set<sedeId>

      for (const c of cotizaciones) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // Helper compartido del service: libera stock y devuelve el
            // adelanto espejando el método de pago original, con fallback
            // a Caja Central si la caja del adelanto ya cerró. (La copia
            // local que vivía acá había divergido: EFECTIVO hardcodeado y
            // sin fallback — el adelanto de una caja cerrada se perdía.)
            await this.cotizacionService.liberarReservas(
              tx,
              c.id,
              'LIBERAR',
              c.vendedorId,
            );
            await tx.cotizacion.update({
              where: { id: c.id },
              data: { estado: EstadoCotizacion.VENCIDA },
            });
          });
          const sedes = empresasAfectadas.get(c.empresaId) ?? new Set();
          sedes.add(c.sedeId);
          empresasAfectadas.set(c.empresaId, sedes);
        } catch (err) {
          this.logger.error(
            `[CRON] Error expirando cotización ${c.codigo}: ${(err as Error).message}`,
          );
        }
      }

      // Notificar a los devices conectados de cada empresa/sede.
      for (const [empresaId, sedes] of empresasAfectadas) {
        for (const sedeId of sedes) {
          this.realtime.notifyStockCambiado({ empresaId, sedeId });
        }
      }
    } catch (err) {
      this.logger.error(
        `[CRON] expirarCotizacionesConReserva falló: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Segunda pasada: cotizaciones vencidas SIN reserva activa. La primera
   * pasada solo toca las que tienen stock reservado; sin esta, una
   * cotización vencida sin reserva se quedaba PENDIENTE/APROBADA para
   * siempre y ensuciaba la cola POS eternamente (caso real: 1000+ horas).
   *
   * Solo se auto-expiran las que NO tienen adelanto: sin stock ni dinero de
   * por medio, marcar VENCIDA es gratis. Las vencidas con adelanto y sin
   * reserva activa (anomalía: la plata está cobrada pero la reserva ya no
   * existe) NO se tocan automáticamente — se loggean para revisión manual,
   * nunca movemos dinero en silencio.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expirarCotizacionesSinReserva() {
    try {
      const ahora = new Date();

      const whereBase: Prisma.CotizacionWhereInput = {
        fechaVencimiento: { lt: ahora },
        estado: {
          in: [
            EstadoCotizacion.BORRADOR,
            EstadoCotizacion.PENDIENTE,
            EstadoCotizacion.APROBADA,
          ],
        },
        detalles: {
          none: { reservaEstado: ReservaCotizacionEstado.ACTIVA },
        },
      };

      const r = await this.prisma.cotizacion.updateMany({
        where: {
          ...whereBase,
          OR: [{ adelantoMonto: null }, { adelantoMonto: { lte: 0 } }],
        },
        data: { estado: EstadoCotizacion.VENCIDA },
      });
      if (r.count > 0) {
        this.logger.info(
          `[CRON] ${r.count} cotización(es) vencida(s) sin reserva ni adelanto → VENCIDA`,
        );
      }

      // Visibilidad de las anómalas (adelanto cobrado, sin reserva activa).
      const conAdelanto = await this.prisma.cotizacion.count({
        where: { ...whereBase, adelantoMonto: { gt: 0 } },
      });
      if (conAdelanto > 0) {
        this.logger.warn(
          `[CRON] ${conAdelanto} cotización(es) vencida(s) con ADELANTO y sin reserva activa — requieren revisión manual (no se auto-expiran)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[CRON] expirarCotizacionesSinReserva falló: ${(err as Error).message}`,
      );
    }
  }

}
