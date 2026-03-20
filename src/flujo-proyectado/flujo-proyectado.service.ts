import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PeriodoProyeccion {
  periodo: string;
  label: string;
  cobrosEsperados: number;
  pagosEsperados: number;
  cuotasPrestamos: number;
  flujoNeto: number;
  saldoProyectado: number;
}

@Injectable()
export class FlujoProyectadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Proyeccion de flujo de caja para los proximos N meses
   */
  async getProyeccion(empresaId: string, meses: number = 3) {
    const now = new Date();

    // Obtener saldo bancario actual como punto de partida
    const saldoInicial = await this._getSaldoBancario(empresaId);

    // Obtener datos en paralelo
    const [ventasCredito, comprasCredito, prestamosActivos] = await Promise.all([
      this._getVentasCredito(empresaId),
      this._getComprasCredito(empresaId),
      this._getPrestamosActivos(empresaId),
    ]);

    // Generar periodos mensuales
    const periodos: PeriodoProyeccion[] = [];
    let saldoAcumulado = saldoInicial;

    for (let i = 0; i < meses; i++) {
      const mesActual = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mesSiguiente = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59, 999);

      const periodoKey = `${mesActual.getFullYear()}-${String(mesActual.getMonth() + 1).padStart(2, '0')}`;
      const label = mesActual.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });

      // Cobros esperados: ventas a credito con vencimiento en este mes
      const cobrosEsperados = ventasCredito
        .filter((v) => {
          if (!v.fechaVencimiento) return false;
          return v.fechaVencimiento >= mesActual && v.fechaVencimiento <= mesSiguiente;
        })
        .reduce((sum, v) => sum + v.saldoPendiente, 0);

      // Pagos esperados: compras a credito con vencimiento en este mes
      const pagosEsperados = comprasCredito
        .filter((c) => {
          if (!c.fechaVencimiento) return false;
          return c.fechaVencimiento >= mesActual && c.fechaVencimiento <= mesSiguiente;
        })
        .reduce((sum, c) => sum + c.saldoPendiente, 0);

      // Cuotas de prestamos: prestamos activos con montoCuota
      const cuotasPrestamos = prestamosActivos.reduce(
        (sum, p) => sum + (p.montoCuota ?? 0),
        0,
      );

      const flujoNeto = cobrosEsperados - pagosEsperados - cuotasPrestamos;
      saldoAcumulado += flujoNeto;

      periodos.push({
        periodo: periodoKey,
        label,
        cobrosEsperados: Math.round(cobrosEsperados * 100) / 100,
        pagosEsperados: Math.round(pagosEsperados * 100) / 100,
        cuotasPrestamos: Math.round(cuotasPrestamos * 100) / 100,
        flujoNeto: Math.round(flujoNeto * 100) / 100,
        saldoProyectado: Math.round(saldoAcumulado * 100) / 100,
      });
    }

    return {
      saldoInicial: Math.round(saldoInicial * 100) / 100,
      mesesProyectados: meses,
      periodos,
    };
  }

  private async _getSaldoBancario(empresaId: string): Promise<number> {
    const cuentas = await this.prisma.empresaBanco.findMany({
      where: { empresaId, isActive: true },
      select: { saldoActual: true },
    });

    return cuentas.reduce((sum, c) => sum + (c.saldoActual ? Number(c.saldoActual) : 0), 0);
  }

  private async _getVentasCredito(empresaId: string) {
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        esCredito: true,
        estado: { not: 'ANULADA' },
      },
      include: { pagos: true },
    });

    return ventas
      .map((v) => {
        const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
        const saldoPendiente = Number(v.total) - pagado;
        return {
          fechaVencimiento: v.fechaVencimientoPago,
          saldoPendiente,
        };
      })
      .filter((v) => v.saldoPendiente > 0);
  }

  private async _getComprasCredito(empresaId: string) {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        estado: 'CONFIRMADA',
        terminosPago: { not: 'CONTADO' },
      },
      include: { pagos: true },
    });

    return compras
      .map((c) => {
        const pagado = c.pagos.reduce((s, p) => s + Number(p.monto), 0);
        const saldoPendiente = Number(c.total) - pagado;
        return {
          fechaVencimiento: c.fechaVencimientoPago,
          saldoPendiente,
        };
      })
      .filter((c) => c.saldoPendiente > 0);
  }

  private async _getPrestamosActivos(empresaId: string) {
    const prestamos = await this.prisma.prestamo.findMany({
      where: {
        empresaId,
        estado: { in: ['ACTIVO', 'VENCIDO'] },
      },
      select: { montoCuota: true, saldoPendiente: true },
    });

    return prestamos.map((p) => ({
      montoCuota: p.montoCuota ? Number(p.montoCuota) : null,
      saldoPendiente: Number(p.saldoPendiente),
    }));
  }
}
