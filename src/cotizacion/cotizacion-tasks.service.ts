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

  /**
   * POLÍTICA DE EXPIRACIÓN (definida con el negocio 2026-07-04):
   * - AUTO: BORRADOR y PENDIENTE vencidas SIN adelanto — con o sin reserva
   *   (el stock reservado siempre vuelve al disponible vía liberarReservas).
   * - MANUAL: APROBADA (compromiso con el cliente) y CUALQUIER cotización
   *   con adelanto cobrado (hay dinero de por medio; el admin la expira
   *   desde el detalle con PATCH :id/estado → VENCIDA, que libera stock y
   *   devuelve el adelanto). La cola POS las marca "vencida" para que no
   *   queden en el olvido.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expirarCotizacionesConReserva() {
    try {
      const ahora = new Date();

      // Vencidas en estado auto-expirable, sin adelanto, con al menos una
      // reserva ACTIVA (necesitan transacción para devolver el stock).
      const cotizaciones = await this.prisma.cotizacion.findMany({
        where: {
          fechaVencimiento: { lt: ahora },
          estado: {
            in: [EstadoCotizacion.BORRADOR, EstadoCotizacion.PENDIENTE],
          },
          OR: [{ adelantoMonto: null }, { adelantoMonto: { lte: 0 } }],
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
   * Segunda pasada: BORRADOR/PENDIENTE vencidas SIN reserva activa y SIN
   * adelanto → VENCIDA directo (sin stock ni dinero, marcar es gratis).
   * Sin esta pasada, una vencida sin reserva se quedaba en la cola POS
   * eternamente (caso real: 1000+ horas).
   *
   * Además loggea lo que queda para gestión MANUAL: APROBADAS vencidas y
   * cualquier vencida con adelanto (ver política arriba).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expirarCotizacionesSinReserva() {
    try {
      const ahora = new Date();

      const r = await this.prisma.cotizacion.updateMany({
        where: {
          fechaVencimiento: { lt: ahora },
          estado: {
            in: [EstadoCotizacion.BORRADOR, EstadoCotizacion.PENDIENTE],
          },
          OR: [{ adelantoMonto: null }, { adelantoMonto: { lte: 0 } }],
          detalles: {
            none: { reservaEstado: ReservaCotizacionEstado.ACTIVA },
          },
        },
        data: { estado: EstadoCotizacion.VENCIDA },
      });
      if (r.count > 0) {
        this.logger.info(
          `[CRON] ${r.count} cotización(es) vencida(s) sin reserva ni adelanto → VENCIDA`,
        );
      }

      // Visibilidad de lo que espera decisión manual (no se auto-expira):
      // APROBADAS vencidas o vencidas con adelanto cobrado.
      const manuales: Prisma.CotizacionWhereInput = {
        fechaVencimiento: { lt: ahora },
        OR: [
          { estado: EstadoCotizacion.APROBADA },
          {
            estado: {
              in: [EstadoCotizacion.BORRADOR, EstadoCotizacion.PENDIENTE],
            },
            adelantoMonto: { gt: 0 },
          },
        ],
      };
      const pendientesManual = await this.prisma.cotizacion.count({
        where: manuales,
      });
      if (pendientesManual > 0) {
        this.logger.warn(
          `[CRON] ${pendientesManual} cotización(es) vencida(s) esperan expiración MANUAL (aprobadas o con adelanto)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[CRON] expirarCotizacionesSinReserva falló: ${(err as Error).message}`,
      );
    }
  }

}
