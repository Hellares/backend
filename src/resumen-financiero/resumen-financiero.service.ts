import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResumenFinancieroService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resumen financiero consolidado de la empresa
   */
  async getResumen(empresaId: string, periodo?: { fechaDesde?: string; fechaHasta?: string }) {
    const fechaDesde = periodo?.fechaDesde ? new Date(periodo.fechaDesde) : this._inicioMes();
    const fechaHasta = periodo?.fechaHasta ? new Date(periodo.fechaHasta) : new Date();

    const [ventas, compras, pedidosMarketplace, cuentasCobrar, cuentasPagar, caja, bancos, prestamos, otrosMovimientos, gastosRecurrentesBanco, agentes] = await Promise.all([
      this._resumenVentas(empresaId, fechaDesde, fechaHasta),
      this._resumenCompras(empresaId, fechaDesde, fechaHasta),
      this._resumenPedidosMarketplace(empresaId, fechaDesde, fechaHasta),
      this._resumenCuentasCobrar(empresaId),
      this._resumenCuentasPagar(empresaId),
      this._resumenCaja(empresaId),
      this._resumenBancos(empresaId),
      this._resumenPrestamos(empresaId),
      this._resumenOtrosMovimientos(empresaId, fechaDesde, fechaHasta),
      this._resumenGastosRecurrentesBanco(empresaId, fechaDesde, fechaHasta),
      this._resumenAgentes(empresaId, fechaDesde, fechaHasta),
    ]);

    const totalIngresos = ventas.totalCobrado + pedidosMarketplace.totalValidado + otrosMovimientos.totalOtrosIngresos;
    // Los pagos de gasto recurrente con fuente=CAJA ya están en otrosMovimientos
    // (entran por MovimientoCaja con categoría GASTO_OPERATIVO). Aquí sumamos solo
    // los pagos con fuente=BANCO que NO generan MovimientoCaja.
    const totalEgresos = compras.totalPagado + prestamos.totalPagadoPeriodo + otrosMovimientos.totalOtrosEgresos + gastosRecurrentesBanco.totalPagosBanco;
    const flujoNeto = totalIngresos - totalEgresos;

    return {
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      resumen: {
        totalIngresos: Math.round(totalIngresos * 100) / 100,
        totalEgresos: Math.round(totalEgresos * 100) / 100,
        flujoNeto: Math.round(flujoNeto * 100) / 100,
      },
      ventas,
      compras,
      pedidosMarketplace,
      cuentasPorCobrar: cuentasCobrar,
      cuentasPorPagar: cuentasPagar,
      caja,
      bancos,
      prestamos,
      otrosMovimientos,
      gastosRecurrentesBanco,
      agentes,
    };
  }

  private async _resumenVentas(empresaId: string, desde: Date, hasta: Date) {
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        fechaVenta: { gte: desde, lte: hasta },
        estado: { not: 'ANULADA' },
      },
      include: { pagos: true },
    });

    const totalVentas = ventas.reduce((s, v) => s + Number(v.total), 0);
    const totalCobrado = ventas.reduce((s, v) => s + v.pagos.reduce((ps, p) => ps + Number(p.monto), 0), 0);
    const ventasCredito = ventas.filter((v) => v.esCredito).length;
    const ventasContado = ventas.length - ventasCredito;

    return {
      cantidad: ventas.length,
      totalVentas: Math.round(totalVentas * 100) / 100,
      totalCobrado: Math.round(totalCobrado * 100) / 100,
      pendienteCobro: Math.round((totalVentas - totalCobrado) * 100) / 100,
      ventasContado,
      ventasCredito,
    };
  }

  private async _resumenCompras(empresaId: string, desde: Date, hasta: Date) {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        fechaRecepcion: { gte: desde, lte: hasta },
        estado: 'CONFIRMADA',
      },
      include: { pagos: true },
    });

    const totalCompras = compras.reduce((s, c) => s + Number(c.total), 0);
    const totalPagado = compras.reduce((s, c) => s + c.pagos.reduce((ps, p) => ps + Number(p.monto), 0), 0);

    return {
      cantidad: compras.length,
      totalCompras: Math.round(totalCompras * 100) / 100,
      totalPagado: Math.round(totalPagado * 100) / 100,
      pendientePago: Math.round((totalCompras - totalPagado) * 100) / 100,
    };
  }

  private async _resumenPedidosMarketplace(empresaId: string, desde: Date, hasta: Date) {
    const pedidos = await this.prisma.pedidoMarketplace.findMany({
      where: {
        empresaId,
        creadoEn: { gte: desde, lte: hasta },
        estado: { not: 'CANCELADO' },
      },
    });

    const totalPedidos = pedidos.reduce((s, p) => s + Number(p.total), 0);
    const validados = pedidos.filter((p) => ['PAGO_VALIDADO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO'].includes(p.estado));
    const totalValidado = validados.reduce((s, p) => s + Number(p.total), 0);
    const pendientes = pedidos.filter((p) => ['PENDIENTE_PAGO', 'PAGO_ENVIADO'].includes(p.estado));

    return {
      cantidad: pedidos.length,
      totalPedidos: Math.round(totalPedidos * 100) / 100,
      totalValidado: Math.round(totalValidado * 100) / 100,
      pedidosPendientes: pendientes.length,
      pedidosEntregados: pedidos.filter((p) => p.estado === 'ENTREGADO').length,
    };
  }

  private async _resumenCuentasCobrar(empresaId: string) {
    const ventas = await this.prisma.venta.findMany({
      where: { empresaId, esCredito: true, estado: { not: 'ANULADA' } },
      include: { pagos: true },
    });

    let totalPendiente = 0;
    let totalVencido = 0;
    const now = new Date();

    for (const v of ventas) {
      const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
      const saldo = Number(v.total) - pagado;
      if (saldo <= 0) continue;
      if (v.fechaVencimientoPago && v.fechaVencimientoPago < now) {
        totalVencido += saldo;
      } else {
        totalPendiente += saldo;
      }
    }

    return {
      totalPendiente: Math.round(totalPendiente * 100) / 100,
      totalVencido: Math.round(totalVencido * 100) / 100,
      total: Math.round((totalPendiente + totalVencido) * 100) / 100,
    };
  }

  private async _resumenCuentasPagar(empresaId: string) {
    const compras = await this.prisma.compra.findMany({
      where: { empresaId, estado: 'CONFIRMADA', terminosPago: { not: 'CONTADO' } },
      include: { pagos: true },
    });

    let totalPendiente = 0;
    let totalVencido = 0;
    const now = new Date();

    for (const c of compras) {
      const pagado = c.pagos.reduce((s, p) => s + Number(p.monto), 0);
      const saldo = Number(c.total) - pagado;
      if (saldo <= 0) continue;
      if (c.fechaVencimientoPago && c.fechaVencimientoPago < now) {
        totalVencido += saldo;
      } else {
        totalPendiente += saldo;
      }
    }

    return {
      totalPendiente: Math.round(totalPendiente * 100) / 100,
      totalVencido: Math.round(totalVencido * 100) / 100,
      total: Math.round((totalPendiente + totalVencido) * 100) / 100,
    };
  }

  private async _resumenCaja(empresaId: string) {
    const cajasAbiertas = await this.prisma.caja.count({
      where: { empresaId, estado: 'ABIERTA' },
    });

    // Movimientos del día
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const movimientosHoy = await this.prisma.movimientoCaja.groupBy({
      by: ['tipo'],
      where: { empresaId, fechaMovimiento: { gte: hoy } },
      _sum: { monto: true },
      _count: true,
    });

    let ingresosHoy = 0;
    let egresosHoy = 0;

    for (const m of movimientosHoy) {
      if (m.tipo === 'INGRESO') ingresosHoy = Number(m._sum.monto ?? 0);
      if (m.tipo === 'EGRESO') egresosHoy = Number(m._sum.monto ?? 0);
    }

    return {
      cajasAbiertas,
      ingresosHoy: Math.round(ingresosHoy * 100) / 100,
      egresosHoy: Math.round(egresosHoy * 100) / 100,
      flujoHoy: Math.round((ingresosHoy - egresosHoy) * 100) / 100,
    };
  }

  private async _resumenBancos(empresaId: string) {
    const cuentas = await this.prisma.empresaBanco.findMany({
      where: { empresaId, isActive: true },
      select: { id: true, nombreBanco: true, moneda: true, saldoActual: true, esPrincipal: true },
    });

    const totalSaldo = cuentas.reduce((s, c) => s + (c.saldoActual ? Number(c.saldoActual) : 0), 0);

    return {
      cantidadCuentas: cuentas.length,
      totalSaldo: Math.round(totalSaldo * 100) / 100,
      cuentas: cuentas.map((c) => ({
        ...c,
        saldoActual: c.saldoActual ? Number(c.saldoActual) : null,
      })),
    };
  }

  /**
   * Datos diarios para gráfico de ingresos vs egresos
   */
  async getGraficoDiario(empresaId: string, fechaDesde?: string, fechaHasta?: string) {
    const desde = fechaDesde ? new Date(fechaDesde) : this._inicioMes();
    const hasta = fechaHasta ? new Date(fechaHasta) : new Date();

    const [movimientos, pagosBanco] = await Promise.all([
      this.prisma.movimientoCaja.findMany({
        where: {
          empresaId,
          fechaMovimiento: { gte: desde, lte: hasta },
        },
        select: { tipo: true, monto: true, fechaMovimiento: true },
        orderBy: { fechaMovimiento: 'asc' },
      }),
      // Pagos de gasto recurrente por BANCO (no generan MovimientoCaja)
      this.prisma.pagoGastoRecurrente.findMany({
        where: {
          empresaId,
          fuente: 'BANCO',
          fechaPago: { gte: desde, lte: hasta },
        },
        select: { montoReal: true, fechaPago: true },
      }),
    ]);

    // Agrupar por día
    const porDia = new Map<string, { fecha: string; ingresos: number; egresos: number }>();

    for (const m of movimientos) {
      const dia = m.fechaMovimiento.toISOString().split('T')[0];
      if (!porDia.has(dia)) {
        porDia.set(dia, { fecha: dia, ingresos: 0, egresos: 0 });
      }
      const d = porDia.get(dia)!;
      if (m.tipo === 'INGRESO') d.ingresos += Number(m.monto);
      else d.egresos += Number(m.monto);
    }

    for (const p of pagosBanco) {
      const dia = p.fechaPago.toISOString().split('T')[0];
      if (!porDia.has(dia)) {
        porDia.set(dia, { fecha: dia, ingresos: 0, egresos: 0 });
      }
      porDia.get(dia)!.egresos += Number(p.montoReal);
    }

    // Llenar días sin movimientos
    const result: any[] = [];
    const current = new Date(desde);
    while (current <= hasta) {
      const dia = current.toISOString().split('T')[0];
      const data = porDia.get(dia) ?? { fecha: dia, ingresos: 0, egresos: 0 };
      result.push({
        fecha: dia,
        ingresos: Math.round(data.ingresos * 100) / 100,
        egresos: Math.round(data.egresos * 100) / 100,
      });
      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  private async _resumenPrestamos(empresaId: string) {
    const prestamos = await this.prisma.prestamo.findMany({
      where: { empresaId, estado: { in: ['ACTIVO', 'VENCIDO'] } },
      include: { pagos: true },
    });

    const totalDeuda = prestamos.reduce((s, p) => s + Number(p.saldoPendiente), 0);
    const totalOriginal = prestamos.reduce((s, p) => s + Number(p.montoOriginal), 0);
    const totalPagado = prestamos.reduce((s, p) => s + Number(p.totalPagado), 0);

    // Pagos del periodo actual (para reflejar en egresos del mes)
    const inicioMes = this._inicioMes();
    const totalPagadoPeriodo = prestamos.reduce((s, p) => {
      return s + p.pagos
        .filter((pg) => pg.fechaPago >= inicioMes)
        .reduce((ps, pg) => ps + Number(pg.monto), 0);
    }, 0);

    return {
      cantidadActivos: prestamos.length,
      totalDeuda: Math.round(totalDeuda * 100) / 100,
      totalOriginal: Math.round(totalOriginal * 100) / 100,
      totalPagado: Math.round(totalPagado * 100) / 100,
      totalPagadoPeriodo: Math.round(totalPagadoPeriodo * 100) / 100,
      porcentajePagado: totalOriginal > 0 ? Math.round((totalPagado / totalOriginal) * 100) : 0,
    };
  }

  /**
   * Resumen de movimientos de caja que no son ventas/compras/préstamos
   * (gastos operativos, otros ingresos, adelantos de servicio, devoluciones, etc.)
   */
  private async _resumenOtrosMovimientos(empresaId: string, desde: Date, hasta: Date) {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        fechaMovimiento: { gte: desde, lte: hasta },
        // Solo categorías que NO se cuentan en otras secciones del resumen
        categoria: { in: ['OTRO_INGRESO', 'GASTO_OPERATIVO', 'ADELANTO_SERVICIO', 'OTRO_EGRESO', 'DEVOLUCION'] },
      },
      select: { tipo: true, categoria: true, monto: true },
    });

    let totalOtrosIngresos = 0;
    let totalOtrosEgresos = 0;
    const porCategoria: Record<string, number> = {};

    for (const m of movimientos) {
      const monto = Number(m.monto);
      if (m.tipo === 'INGRESO') totalOtrosIngresos += monto;
      else totalOtrosEgresos += monto;

      porCategoria[m.categoria] = (porCategoria[m.categoria] ?? 0) + monto;
    }

    return {
      totalOtrosIngresos: Math.round(totalOtrosIngresos * 100) / 100,
      totalOtrosEgresos: Math.round(totalOtrosEgresos * 100) / 100,
      porCategoria,
    };
  }

  private async _resumenAgentes(empresaId: string, desde?: Date, hasta?: Date) {
    const where: any = { empresaId, anulado: false };
    if (desde || hasta) {
      where.fechaOperacion = {};
      if (desde) where.fechaOperacion.gte = desde;
      if (hasta) where.fechaOperacion.lte = hasta;
    }

    const operaciones = await this.prisma.operacionAgente.findMany({
      where,
      select: { tipo: true, monto: true, comision: true },
    });

    const depositos = operaciones.filter((o) => o.tipo === 'DEPOSITO');
    const retiros = operaciones.filter((o) => o.tipo === 'RETIRO');

    return {
      totalDepositos: Math.round(depositos.reduce((s, o) => s + Number(o.monto), 0) * 100) / 100,
      totalRetiros: Math.round(retiros.reduce((s, o) => s + Number(o.monto), 0) * 100) / 100,
      cantidadDepositos: depositos.length,
      cantidadRetiros: retiros.length,
      comisionesGanadas: Math.round(operaciones.reduce((s, o) => s + Number(o.comision), 0) * 100) / 100,
    };
  }

  /**
   * Pagos de gastos recurrentes con fuente=BANCO en el período.
   * NO genera MovimientoCaja (solo decrementa EmpresaBanco.saldoActual), así
   * que sin este resumen los reportes de egresos del mes se quedarían cortos.
   * Los pagos con fuente=CAJA ya entran vía MovimientoCaja en _resumenOtrosMovimientos.
   */
  private async _resumenGastosRecurrentesBanco(empresaId: string, desde: Date, hasta: Date) {
    const pagos = await this.prisma.pagoGastoRecurrente.findMany({
      where: {
        empresaId,
        fuente: 'BANCO',
        fechaPago: { gte: desde, lte: hasta },
      },
      select: {
        montoReal: true,
        gastoRecurrente: {
          select: {
            categoriaGasto: { select: { nombre: true } },
          },
        },
      },
    });

    let totalPagosBanco = 0;
    const porCategoria: Record<string, number> = {};

    for (const p of pagos) {
      const monto = Number(p.montoReal);
      totalPagosBanco += monto;
      const cat = p.gastoRecurrente.categoriaGasto.nombre;
      porCategoria[cat] = (porCategoria[cat] ?? 0) + monto;
    }

    return {
      cantidad: pagos.length,
      totalPagosBanco: Math.round(totalPagosBanco * 100) / 100,
      porCategoria,
    };
  }

  private _inicioMes(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
