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
          this._verificarCajasConDiscrepancia(empresa.id, empresa.nombre),
          this._verificarCajasAbiertasSinActividad(empresa.id, empresa.nombre),
          this._verificarCajasChicasFondoBajo(empresa.id, empresa.nombre),
          this._verificarLotesProximosVencer(empresa.id, empresa.nombre),
          this._verificarAgentesBancariosFondoBajo(empresa.id, empresa.nombre),
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
   * Alerta: cajas cerradas con discrepancia significativa (> S/ 5)
   */
  private async _verificarCajasConDiscrepancia(empresaId: string, empresaNombre: string) {
    try {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      ayer.setHours(0, 0, 0, 0);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      const cierres = await this.prisma.cierreCaja.findMany({
        where: {
          caja: { empresaId },
          creadoEn: { gte: ayer, lt: hoy },
        },
        select: {
          diferencia: true,
          caja: {
            select: { codigo: true, sede: { select: { nombre: true } } },
          },
        },
      });

      const conDiscrepancia = cierres.filter(
        (c) => Math.abs(Number(c.diferencia ?? 0)) > 5,
      );

      if (conDiscrepancia.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = conDiscrepancia
            .map(
              (c) =>
                `- Caja ${c.caja.codigo} (${c.caja.sede?.nombre ?? 'Sin sede'}): discrepancia S/ ${Number(c.diferencia).toFixed(2)}`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Discrepancias en cierre de caja',
            `Se detectaron ${conDiscrepancia.length} caja(s) con discrepancias significativas en el cierre de ayer:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando discrepancias caja [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: cajas abiertas por más de 24 horas sin movimientos
   */
  private async _verificarCajasAbiertasSinActividad(empresaId: string, empresaNombre: string) {
    try {
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const cajasAbiertas = await this.prisma.caja.findMany({
        where: {
          empresaId,
          estado: 'ABIERTA',
          fechaApertura: { lt: hace24h },
        },
        include: {
          sede: { select: { nombre: true } },
          movimientos: {
            where: { fechaMovimiento: { gte: hace24h } },
            select: { id: true },
            take: 1,
          },
        },
      });

      const sinActividad = cajasAbiertas.filter((c) => c.movimientos.length === 0);

      if (sinActividad.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = sinActividad
            .map(
              (c) =>
                `- Caja ${c.codigo} (${c.sede?.nombre ?? 'Sin sede'}) - Abierta desde ${c.fechaApertura.toLocaleDateString('es-PE')}`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Cajas abiertas sin actividad',
            `Hay ${sinActividad.length} caja(s) abiertas por mas de 24h sin movimientos recientes:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando cajas sin actividad [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: cajas chicas con fondo por debajo del umbral configurado
   */
  private async _verificarCajasChicasFondoBajo(empresaId: string, empresaNombre: string) {
    try {
      const cajasChicas = await this.prisma.cajaChica.findMany({
        where: {
          empresaId,
          estado: 'ACTIVA',
          umbralAlerta: { gt: 0 },
        },
        select: {
          nombre: true,
          saldoActual: true,
          umbralAlerta: true,
          fondoFijo: true,
          sede: { select: { nombre: true } },
        },
      });

      const conFondoBajo = cajasChicas.filter(
        (c) => Number(c.saldoActual) <= Number(c.umbralAlerta),
      );

      if (conFondoBajo.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = conFondoBajo
            .map(
              (c) =>
                `- ${c.nombre} (${c.sede?.nombre ?? 'Sin sede'}): saldo S/ ${Number(c.saldoActual).toFixed(2)} / fondo S/ ${Number(c.fondoFijo).toFixed(2)} (umbral: S/ ${Number(c.umbralAlerta).toFixed(2)})`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Cajas chicas con fondo bajo',
            `Hay ${conFondoBajo.length} caja(s) chica(s) con saldo por debajo del umbral de alerta:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando cajas chicas fondo bajo [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: lotes proximos a vencer (30 dias) + marcar vencidos automaticamente
   */
  private async _verificarLotesProximosVencer(empresaId: string, empresaNombre: string) {
    try {
      const now = new Date();
      const en30Dias = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Auto-marcar lotes vencidos
      await this.prisma.lote.updateMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          fechaVencimiento: { lt: now },
        },
        data: { estado: 'VENCIDO' },
      });

      // Buscar lotes por vencer en 30 dias
      const lotesProximos = await this.prisma.lote.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          fechaVencimiento: { gte: now, lte: en30Dias },
          cantidadActual: { gt: 0 },
        },
        select: {
          codigo: true,
          fechaVencimiento: true,
          cantidadActual: true,
          producto: { select: { nombre: true } },
        },
      });

      if (lotesProximos.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = lotesProximos
            .map((l) => `- ${l.producto?.nombre ?? 'Producto'} (Lote ${l.codigo}): ${l.cantidadActual} und. vence ${l.fechaVencimiento?.toLocaleDateString('es-PE')}`)
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Lotes proximos a vencer',
            `Hay ${lotesProximos.length} lote(s) que vencen en los proximos 30 dias:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando lotes [${empresaNombre}]: ${error?.message}`);
    }
  }

  /**
   * Alerta: agentes bancarios con fondo bajo (saldoActual < 20% de fondoAsignado)
   */
  private async _verificarAgentesBancariosFondoBajo(empresaId: string, empresaNombre: string) {
    try {
      const agentes = await this.prisma.agenteBancario.findMany({
        where: { empresaId, estado: 'ACTIVO' },
        select: {
          id: true,
          banco: true,
          fondoAsignado: true,
          saldoActual: true,
          sede: { select: { nombre: true } },
        },
      });

      const agentesAlerta = agentes.filter(
        (a) => Number(a.saldoActual) < Number(a.fondoAsignado) * 0.2,
      );

      if (agentesAlerta.length > 0) {
        const admins = await this._getAdminsContadores(empresaId);
        if (admins.length > 0) {
          const detalles = agentesAlerta
            .map(
              (a) =>
                `- ${a.banco} (${a.sede?.nombre ?? 'Sin sede'}): saldo S/ ${Number(a.saldoActual).toFixed(2)} / fondo S/ ${Number(a.fondoAsignado).toFixed(2)}`,
            )
            .join('\n');

          await this.notificacionService.enviarAUsuarios(
            admins,
            'Alerta: Agentes bancarios con fondo bajo',
            `Hay ${agentesAlerta.length} agente(s) bancario(s) con saldo por debajo del 20% de su fondo asignado:\n${detalles}`,
            { tipo: 'SISTEMA', empresaId },
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Error verificando agentes bancarios fondo bajo [${empresaNombre}]: ${error?.message}`);
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
