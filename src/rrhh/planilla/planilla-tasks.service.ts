import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EstadoPeriodoPlanilla } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tareas programadas de planilla.
 */
@Injectable()
export class PlanillaTasksService {
  private readonly logger = new Logger(PlanillaTasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cada día a las 6am: para cada empresa que YA usa planilla (tiene al menos
   * un periodo histórico), crea el periodo del MES ACTUAL en BORRADOR si aún no
   * existe. Idempotente: si ya existe (cualquier sede), no hace nada.
   *
   * No fuerza nada: el periodo queda en BORRADOR hasta que alguien lo calcule.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async autoCrearPeriodoDelMes() {
    try {
      const ahora = new Date();
      const anio = ahora.getUTCFullYear();
      const mes = ahora.getUTCMonth() + 1;
      const periodo = `${anio}-${String(mes).padStart(2, '0')}`;

      // Empresas que ya usan planilla (tienen historial de periodos).
      const empresas = await this.prisma.periodoPlanilla.findMany({
        distinct: ['empresaId'],
        select: { empresaId: true },
      });
      if (empresas.length === 0) return;

      const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1));
      const fechaFin = new Date(Date.UTC(anio, mes, 0)); // último día del mes

      let creados = 0;
      for (const { empresaId } of empresas) {
        // ¿Ya existe el periodo del mes actual (en cualquier sede)?
        const existe = await this.prisma.periodoPlanilla.findFirst({
          where: { empresaId, periodo },
          select: { id: true },
        });
        if (existe) continue;

        await this.prisma.periodoPlanilla.create({
          data: {
            empresaId,
            sedeId: null,
            periodo,
            mes,
            anio,
            fechaInicio,
            fechaFin,
            estado: EstadoPeriodoPlanilla.BORRADOR,
            observaciones: 'Generado automáticamente',
          },
        });
        creados++;
      }

      if (creados > 0) {
        this.logger.log(
          `Auto-creados ${creados} periodo(s) de planilla para ${periodo}`,
        );
      }
    } catch (err) {
      this.logger.error(`Error en autoCrearPeriodoDelMes: ${err.message}`);
    }
  }
}
