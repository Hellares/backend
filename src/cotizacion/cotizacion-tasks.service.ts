import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CategoriaMovimientoCaja,
  EstadoCotizacion,
  MetodoPagoVenta,
  Prisma,
  ReservaCotizacionEstado,
  TipoMovimientoCaja,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { AppLoggerService } from '../common/logger/logger.service';

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
            await this._liberarReservasYDevolverAdelanto(tx, c);
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

  /// Libera reservas + devuelve adelanto (si lo había y la caja sigue
  /// abierta). Idéntico al helper privado del service pero sin la
  /// opción 'CONVERTIR' (acá solo se libera).
  private async _liberarReservasYDevolverAdelanto(
    tx: Prisma.TransactionClient,
    cot: {
      id: string;
      empresaId: string;
      codigo: string;
      movimientoCajaId: string | null;
      adelantoMonto: Prisma.Decimal | null;
      vendedorId: string;
    },
  ): Promise<void> {
    const detalles = await tx.cotizacionDetalle.findMany({
      where: {
        cotizacionId: cot.id,
        reservaEstado: ReservaCotizacionEstado.ACTIVA,
      },
      select: {
        id: true,
        productoStockId: true,
        cantidadReservada: true,
      },
    });

    for (const d of detalles) {
      if (!d.productoStockId || !d.cantidadReservada) continue;
      await tx.productoStock.update({
        where: { id: d.productoStockId },
        data: {
          stockReservadoCotizacion: { decrement: d.cantidadReservada },
        },
      });
      await tx.cotizacionDetalle.update({
        where: { id: d.id },
        data: { reservaEstado: ReservaCotizacionEstado.LIBERADA },
      });
    }

    // Devolver adelanto si lo tenía y la caja sigue abierta.
    if (
      cot.movimientoCajaId &&
      cot.adelantoMonto != null &&
      Number(cot.adelantoMonto) > 0
    ) {
      const ingresoOriginal = await tx.movimientoCaja.findUnique({
        where: { id: cot.movimientoCajaId },
        select: { cajaId: true, anulado: true },
      });
      if (ingresoOriginal && !ingresoOriginal.anulado) {
        const caja = await tx.caja.findUnique({
          where: { id: ingresoOriginal.cajaId },
          select: { estado: true },
        });
        if (caja?.estado === 'ABIERTA') {
          await tx.movimientoCaja.create({
            data: {
              cajaId: ingresoOriginal.cajaId,
              empresaId: cot.empresaId,
              tipo: TipoMovimientoCaja.EGRESO,
              categoria:
                CategoriaMovimientoCaja.DEVOLUCION_ADELANTO_COTIZACION,
              metodoPago: MetodoPagoVenta.EFECTIVO,
              monto: cot.adelantoMonto,
              descripcion: `Devolución adelanto cotización ${cot.codigo} (expirada)`,
              cotizacionId: cot.id,
              registradoPorId: cot.vendedorId,
              esManual: false, // automático por cron
            },
          });
        }
      }
    }
  }
}
