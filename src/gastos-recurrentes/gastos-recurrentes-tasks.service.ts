import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FrecuenciaGasto, TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { AppLoggerService } from '../common/logger/logger.service';

const MS_DIA = 24 * 60 * 60 * 1000;
const DIAS_PRE_AVISO = 3;

/**
 * Ventana en días dentro de la cual consideramos que el gasto YA está pagado
 * según su frecuencia. Si el último pago cae dentro de esta ventana, el gasto
 * no requiere alerta este ciclo.
 */
const VENTANA_VIGENCIA_DIAS: Record<FrecuenciaGasto, number> = {
  MENSUAL: 28,
  BIMESTRAL: 58,
  TRIMESTRAL: 88,
  ANUAL: 358,
};

@Injectable()
export class GastosRecurrentesTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(GastosRecurrentesTasksService.name);
  }

  /**
   * Cada día a las 8am: avisar de gastos recurrentes por vencer en los próximos
   * 3 días o ya vencidos del mes actual, agrupados por empresa.
   *
   * Considera la frecuencia: si el gasto ya fue pagado dentro de su ventana de
   * vigencia (mensual=28d, bimestral=58d, trimestral=88d, anual=358d), no alerta.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async alertarVencimientos() {
    try {
      const ahora = new Date();
      const gastosActivos = await this.prisma.gastoRecurrente.findMany({
        where: { activo: true },
        select: {
          id: true,
          empresaId: true,
          nombre: true,
          montoEstimado: true,
          frecuencia: true,
          diaVencimiento: true,
          ultimoPagoEn: true,
        },
      });

      if (gastosActivos.length === 0) return;

      // Día del mes actual al que aplica la próxima cuota
      const ultimoDiaDelMes = new Date(
        ahora.getFullYear(),
        ahora.getMonth() + 1,
        0,
      ).getDate();

      type Agrupacion = {
        porVencer: number;
        vencidos: number;
        monto: number;
        nombres: string[];
      };
      const porEmpresa = new Map<string, Agrupacion>();

      for (const g of gastosActivos) {
        // 1. Si ya hay pago vigente según ventana de frecuencia, skip
        if (g.ultimoPagoEn) {
          const diasDesdeUltimo = Math.floor(
            (ahora.getTime() - g.ultimoPagoEn.getTime()) / MS_DIA,
          );
          if (diasDesdeUltimo < VENTANA_VIGENCIA_DIAS[g.frecuencia]) {
            continue;
          }
        }

        // 2. Fecha de vencimiento dentro del mes actual (cap al último día si
        //    el día configurado excede el mes — ej. diaVencimiento=31 en feb).
        const diaEfectivo = Math.min(g.diaVencimiento, ultimoDiaDelMes);
        const fechaVencimiento = new Date(
          ahora.getFullYear(),
          ahora.getMonth(),
          diaEfectivo,
        );
        const diasParaVencer = Math.floor(
          (fechaVencimiento.getTime() - ahora.getTime()) / MS_DIA,
        );

        let bucket: 'porVencer' | 'vencidos' | null = null;
        if (diasParaVencer < 0) bucket = 'vencidos';
        else if (diasParaVencer <= DIAS_PRE_AVISO) bucket = 'porVencer';
        if (!bucket) continue;

        if (!porEmpresa.has(g.empresaId)) {
          porEmpresa.set(g.empresaId, {
            porVencer: 0,
            vencidos: 0,
            monto: 0,
            nombres: [],
          });
        }
        const grupo = porEmpresa.get(g.empresaId)!;
        grupo[bucket]++;
        grupo.monto += Number(g.montoEstimado);
        if (grupo.nombres.length < 3) grupo.nombres.push(g.nombre);
      }

      if (porEmpresa.size === 0) {
        this.logger.info(
          `Sin gastos recurrentes por vencer/vencidos hoy (${gastosActivos.length} activos revisados)`,
        );
        return;
      }

      let empresasNotificadas = 0;
      for (const [empresaId, datos] of porEmpresa) {
        const destinatarios = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            empresaId,
            rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CONTADOR'] },
            isActive: true,
          },
          select: { usuarioId: true },
        });
        const usuarioIds = [...new Set(destinatarios.map((d) => d.usuarioId))];
        if (usuarioIds.length === 0) continue;

        const partes: string[] = [];
        if (datos.vencidos > 0) {
          partes.push(`${datos.vencidos} vencido${datos.vencidos > 1 ? 's' : ''}`);
        }
        if (datos.porVencer > 0) {
          partes.push(`${datos.porVencer} por vencer`);
        }

        const ejemplo = datos.nombres.slice(0, 2).join(', ');
        const sufijo = datos.nombres.length > 2 ? '…' : '';

        await this.notificacionService.enviarAUsuarios(
          usuarioIds,
          'Gastos recurrentes',
          `${partes.join(' y ')} (${ejemplo}${sufijo}) — total estimado S/ ${datos.monto.toFixed(2)}.`,
          {
            tipo: TipoNotificacion.SISTEMA,
            empresaId,
          },
        );
        empresasNotificadas++;
      }

      if (empresasNotificadas > 0) {
        this.logger.info(
          `Alertas de gastos recurrentes enviadas a ${empresasNotificadas} empresa${empresasNotificadas > 1 ? 's' : ''}`,
        );
      }
    } catch (err) {
      this.logger.error(`Error en alertarVencimientos: ${err.message}`);
    }
  }
}
