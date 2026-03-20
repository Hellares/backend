import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';

@Injectable()
export class AlertasFinancierasTasksService {
  private readonly logger = new Logger(AlertasFinancierasTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
  ) {}

  /**
   * Ejecuta todas las verificaciones de alertas financieras diariamente a las 8 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async ejecutarAlertas() {
    this.logger.log('Ejecutando alertas financieras diarias');

    try {
      const empresas = await this.prisma.empresa.findMany({
        where: { deletedAt: null },
        select: { id: true, nombre: true },
      });

      for (const empresa of empresas) {
        await Promise.all([
          this._verificarSaldoBancario(empresa.id, empresa.nombre),
          this._verificarCuotasPrestamo(empresa.id, empresa.nombre),
          this._verificarMetasPorVencer(empresa.id, empresa.nombre),
          this._verificarCuentasPorCobrarVencidas(empresa.id, empresa.nombre),
        ]);
      }

      this.logger.log('Alertas financieras completadas');
    } catch (error: any) {
      this.logger.error(`Error en alertas financieras: ${error?.message}`);
    }
  }

  /**
   * Alerta: saldo bancario por debajo del umbral (< 1000)
   */
  private async _verificarSaldoBancario(empresaId: string, empresaNombre: string) {
    const UMBRAL_SALDO = 1000;

    try {
      const cuentas = await this.prisma.empresaBanco.findMany({
        where: { empresaId, isActive: true },
        select: { saldoActual: true, nombreBanco: true },
      });

      const saldoTotal = cuentas.reduce(
        (sum, c) => sum + (c.saldoActual ? Number(c.saldoActual) : 0),
        0,
      );

      if (saldoTotal < UMBRAL_SALDO) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Saldo bancario bajo',
            `El saldo total de tus cuentas bancarias es S/ ${saldoTotal.toFixed(2)}, por debajo del umbral de S/ ${UMBRAL_SALDO.toFixed(2)}.`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando saldo bancario [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: cuotas de prestamo proximas a vencer (7 dias)
   */
  private async _verificarCuotasPrestamo(empresaId: string, empresaNombre: string) {
    try {
      const now = new Date();
      const sieteDias = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const prestamos = await this.prisma.prestamo.findMany({
        where: {
          empresaId,
          estado: { in: ['ACTIVO', 'VENCIDO'] },
          fechaVencimiento: { gte: now, lte: sieteDias },
        },
        select: {
          entidadPrestamo: true,
          montoCuota: true,
          saldoPendiente: true,
          fechaVencimiento: true,
        },
      });

      if (prestamos.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = prestamos
            .map(
              (p) =>
                `- ${p.entidadPrestamo}: cuota S/ ${p.montoCuota ? Number(p.montoCuota).toFixed(2) : 'N/A'} (vence ${p.fechaVencimiento?.toLocaleDateString('es-PE')})`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Cuotas de prestamo proximas',
            `Tienes ${prestamos.length} prestamo(s) con vencimiento en los proximos 7 dias:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando cuotas prestamo [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: metas financieras por vencer sin cumplir
   */
  private async _verificarMetasPorVencer(empresaId: string, empresaNombre: string) {
    try {
      const now = new Date();
      const sieteDias = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const metas = await this.prisma.metaFinanciera.findMany({
        where: {
          empresaId,
          isActive: true,
          fechaFin: { gte: now, lte: sieteDias },
        },
        select: {
          id: true,
          nombre: true,
          tipo: true,
          montoMeta: true,
          fechaFin: true,
        },
      });

      if (metas.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = metas
            .map(
              (m) =>
                `- ${m.nombre} (${m.tipo}): meta S/ ${Number(m.montoMeta).toFixed(2)} - vence ${m.fechaFin.toLocaleDateString('es-PE')}`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Metas financieras por vencer',
            `Tienes ${metas.length} meta(s) financiera(s) que vencen en los proximos 7 dias:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando metas [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: cuentas por cobrar vencidas
   */
  private async _verificarCuentasPorCobrarVencidas(empresaId: string, empresaNombre: string) {
    try {
      const now = new Date();

      const ventasVencidas = await this.prisma.venta.findMany({
        where: {
          empresaId,
          esCredito: true,
          estado: { not: 'ANULADA' },
          fechaVencimientoPago: { lt: now },
        },
        include: { pagos: true },
      });

      // Filtrar solo las que tienen saldo pendiente
      const conSaldoPendiente = ventasVencidas.filter((v) => {
        const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
        return Number(v.total) - pagado > 0;
      });

      if (conSaldoPendiente.length > 0) {
        const totalVencido = conSaldoPendiente.reduce((sum, v) => {
          const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
          return sum + (Number(v.total) - pagado);
        }, 0);

        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Cuentas por cobrar vencidas',
            `Tienes ${conSaldoPendiente.length} venta(s) a credito vencidas con un total pendiente de S/ ${totalVencido.toFixed(2)}.`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando cuentas por cobrar [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Obtiene los IDs de usuarios con rol EMPRESA_ADMIN o CONTADOR en la empresa
   */
  private async _getAdminsContadores(empresaId: string): Promise<string[]> {
    const roles = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        rol: { in: ['EMPRESA_ADMIN', 'CONTADOR'] },
        isActive: true,
        deletedAt: null,
      },
      select: { usuarioId: true },
    });

    return [...new Set(roles.map((r) => r.usuarioId))];
  }
}
