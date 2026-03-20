import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { TipoNotificacion } from '@prisma/client';

@Injectable()
export class CuentasPorCobrarTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CuentasPorCobrarTasksService.name);
  }

  /**
   * Cada día a las 8am: alertar sobre cuentas vencidas y por vencer
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async alertarVencimientos() {
    try {
      const now = new Date();
      const en3Dias = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      // Ventas a crédito por vencer en 3 días o ya vencidas
      const ventasAlerta = await this.prisma.venta.findMany({
        where: {
          esCredito: true,
          estado: { not: 'ANULADA' },
          fechaVencimientoPago: { lte: en3Dias },
        },
        include: {
          pagos: { select: { monto: true } },
        },
      });

      // Agrupar por empresa
      const porEmpresa = new Map<string, { vencidas: number; porVencer: number; montoTotal: number }>();

      for (const venta of ventasAlerta) {
        const totalPagado = venta.pagos.reduce((s, p) => s + Number(p.monto), 0);
        const saldo = Number(venta.total) - totalPagado;
        if (saldo <= 0) continue; // Ya pagada

        if (!porEmpresa.has(venta.empresaId)) {
          porEmpresa.set(venta.empresaId, { vencidas: 0, porVencer: 0, montoTotal: 0 });
        }

        const grupo = porEmpresa.get(venta.empresaId)!;
        grupo.montoTotal += saldo;

        if (venta.fechaVencimientoPago && venta.fechaVencimientoPago < now) {
          grupo.vencidas++;
        } else {
          grupo.porVencer++;
        }
      }

      for (const [empresaId, datos] of porEmpresa) {
        if (datos.vencidas === 0 && datos.porVencer === 0) continue;

        const admins = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            empresaId,
            rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CONTADOR'] },
            isActive: true,
          },
          select: { usuarioId: true },
        });

        const adminIds = [...new Set(admins.map((a) => a.usuarioId))];
        if (adminIds.length === 0) continue;

        const partes: string[] = [];
        if (datos.vencidas > 0) partes.push(`${datos.vencidas} vencida${datos.vencidas > 1 ? 's' : ''}`);
        if (datos.porVencer > 0) partes.push(`${datos.porVencer} por vencer`);

        await this.notificacionService.enviarAUsuarios(
          adminIds,
          'Cuentas por cobrar',
          `Tienes ${partes.join(' y ')} por S/ ${datos.montoTotal.toFixed(2)} total.`,
          {
            tipo: TipoNotificacion.SISTEMA,
            empresaId,
          },
        );
      }

      if (porEmpresa.size > 0) {
        this.logger.info(`Alertas de cobranza enviadas a ${porEmpresa.size} empresas`);
      }
    } catch (error) {
      this.logger.error(`Error en alertas de cobranza: ${error.message}`);
    }
  }
}
