import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POLÍTICA DE COHERENCIA del resumen (evitar dobles conteos):
 * - INGRESOS = cobros REALES del período (PagoVenta no anulado por fechaPago,
 *   sin importar cuándo se emitió la venta) + pedidos marketplace ya pagados
 *   que AÚN no tienen venta interna + otros ingresos de caja puros.
 * - Los adelantos (servicio/cotización) NO se suman al recibirse: se cuentan
 *   recién cuando se convierten en PagoVenta al cobrar/convertir. Un sol entra
 *   al resumen UNA sola vez.
 * - EGRESOS = pagos REALES del período (PagoCompra no anulado) + préstamos +
 *   gastos de caja (incluye planilla y reposición de caja chica, que es el
 *   rastro contable de sus gastos rendidos) + gastos recurrentes por banco.
 */
@Injectable()
export class ResumenFinancieroService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resumen financiero consolidado de la empresa (o de UNA sede si viene
   * sedeId). Con sede: ventas/compras/CxC/CxP/caja/tesorería/otros/agentes se
   * filtran; bancos, préstamos y pedidos marketplace son de EMPRESA y quedan
   * FUERA de los totales (mezclar alcances daría números incoherentes) — el
   * front los muestra etiquetados "toda la empresa".
   */
  async getResumen(
    empresaId: string,
    periodo?: { fechaDesde?: string; fechaHasta?: string; sedeId?: string },
  ) {
    const fechaDesde = this._parseFecha(periodo?.fechaDesde, false) ?? this._inicioMes();
    const fechaHasta = this._parseFecha(periodo?.fechaHasta, true) ?? new Date();
    const sedeId = periodo?.sedeId || undefined;

    const [ventas, compras, pedidosMarketplace, cuentasCobrar, cuentasPagar, caja, bancos, tesoreria, prestamos, otrosMovimientos, gastosRecurrentesBanco, agentes] = await Promise.all([
      this._resumenVentas(empresaId, fechaDesde, fechaHasta, sedeId),
      this._resumenCompras(empresaId, fechaDesde, fechaHasta, sedeId),
      this._resumenPedidosMarketplace(empresaId, fechaDesde, fechaHasta),
      this._resumenCuentasCobrar(empresaId, sedeId),
      this._resumenCuentasPagar(empresaId, sedeId),
      this._resumenCaja(empresaId, sedeId),
      this._resumenBancos(empresaId),
      this._resumenTesoreria(empresaId, sedeId),
      this._resumenPrestamos(empresaId, fechaDesde, fechaHasta),
      this._resumenOtrosMovimientos(empresaId, fechaDesde, fechaHasta, sedeId),
      this._resumenGastosRecurrentesBanco(empresaId, fechaDesde, fechaHasta, sedeId),
      this._resumenAgentes(empresaId, fechaDesde, fechaHasta, sedeId),
    ]);

    // Ver política de coherencia arriba: cada sol se cuenta UNA vez.
    // pedidosMarketplace.totalPorFacturar cubre el dinero ya validado cuyo
    // pedido aún no genera venta interna (al ENVIAR nace la venta con sus
    // PagoVenta y pasa a contarse por ahí). Con sede seleccionada, pedidos y
    // préstamos (empresa-level) quedan fuera de los totales.
    const aportePedidos = sedeId ? 0 : pedidosMarketplace.totalPorFacturar;
    const aportePrestamos = sedeId ? 0 : prestamos.totalPagadoPeriodo;
    const totalIngresos = ventas.totalCobrado + aportePedidos + otrosMovimientos.totalOtrosIngresos;
    // Los pagos de gasto recurrente con fuente=CAJA ya están en otrosMovimientos
    // (entran por MovimientoCaja con categoría GASTO_OPERATIVO). Aquí sumamos solo
    // los pagos con fuente=BANCO que NO generan MovimientoCaja.
    const totalEgresos = compras.totalPagado + aportePrestamos + otrosMovimientos.totalOtrosEgresos + gastosRecurrentesBanco.totalPagosBanco;
    const flujoNeto = totalIngresos - totalEgresos;

    // Liquidez: dónde está la plata HOY (no depende del período). Con sede,
    // los bancos (empresa) no suman: liquidez = efectivo de ESA sede.
    const liquidezTotal = r2(
      tesoreria.saldoBovedas + tesoreria.efectivoCajasAbiertas + tesoreria.saldoCajaChica + (sedeId ? 0 : bancos.totalSaldo),
    );

    return {
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      alcance: sedeId ? 'SEDE' : 'EMPRESA',
      sedeId: sedeId ?? null,
      resumen: {
        totalIngresos: r2(totalIngresos),
        totalEgresos: r2(totalEgresos),
        flujoNeto: r2(flujoNeto),
        liquidezTotal,
      },
      ventas,
      compras,
      pedidosMarketplace,
      cuentasPorCobrar: cuentasCobrar,
      cuentasPorPagar: cuentasPagar,
      caja,
      bancos,
      tesoreria: {
        ...tesoreria,
        saldoBancos: bancos.totalSaldo,
        // Con sede seleccionada los bancos no suman a la liquidez (empresa).
        incluyeBancos: !sedeId,
        liquidezTotal,
      },
      prestamos,
      otrosMovimientos,
      gastosRecurrentesBanco,
      agentes,
    };
  }

  private async _resumenVentas(empresaId: string, desde: Date, hasta: Date, sedeId?: string) {
    // BORRADOR excluido: las ventas Yape diferidas nacen BORRADOR y pueden
    // cancelarse sin cobrarse — no son ventas todavía.
    const [ventas, cobradoAgg] = await Promise.all([
      this.prisma.venta.findMany({
        where: {
          empresaId,
          ...(sedeId && { sedeId }),
          fechaVenta: { gte: desde, lte: hasta },
          estado: { notIn: ['ANULADA', 'BORRADOR'] },
        },
        include: {
          pagos: { where: { anulado: false } },
          cuotas: { where: { estado: { not: 'ANULADA' } } },
        },
      }),
      // COBRADO = base caja del período: pagos no anulados RECIBIDOS en el
      // período, de cualquier venta viva (incluye abonos CxC de ventas
      // anteriores; excluye pagos futuros de ventas del período).
      this.prisma.pagoVenta.aggregate({
        _sum: { monto: true },
        where: {
          anulado: false,
          fechaPago: { gte: desde, lte: hasta },
          venta: { empresaId, ...(sedeId && { sedeId }), estado: { not: 'ANULADA' } },
        },
      }),
    ]);

    const totalVentas = ventas.reduce((s, v) => s + Number(v.total), 0);
    const totalCobrado = Number(cobradoAgg._sum.monto ?? 0);

    // Pendiente de cobro DE LAS VENTAS DEL PERÍODO (mismo criterio canónico
    // que CxC: saldo desde cuotas si existen; si no, totalConInteres − pagos).
    let pendienteCobro = 0;
    for (const v of ventas) {
      pendienteCobro += this._saldoVenta(v);
    }

    const ventasCredito = ventas.filter((v) => v.esCredito).length;
    const ventasContado = ventas.length - ventasCredito;

    return {
      cantidad: ventas.length,
      totalVentas: r2(totalVentas),
      totalCobrado: r2(totalCobrado),
      pendienteCobro: r2(pendienteCobro),
      ventasContado,
      ventasCredito,
    };
  }

  /** Saldo pendiente canónico de una venta (mismo criterio que CxC). */
  private _saldoVenta(v: {
    total: any;
    totalConInteres?: any;
    pagos: { monto: any }[];
    cuotas?: { saldoPendiente: any }[];
  }): number {
    if (v.cuotas && v.cuotas.length > 0) {
      return Math.max(
        r2(v.cuotas.reduce((s, c) => s + Number(c.saldoPendiente), 0)),
        0,
      );
    }
    const target = Number(v.totalConInteres ?? v.total);
    const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
    return Math.max(r2(target - pagado), 0);
  }

  private async _resumenCompras(empresaId: string, desde: Date, hasta: Date, sedeId?: string) {
    const [compras, pagadoAgg] = await Promise.all([
      this.prisma.compra.findMany({
        where: {
          empresaId,
          ...(sedeId && { sedeId }),
          fechaRecepcion: { gte: desde, lte: hasta },
          estado: 'CONFIRMADA',
        },
        include: { pagos: { where: { anulado: false } } },
      }),
      // PAGADO = base caja del período: pagos no anulados HECHOS en el
      // período, de cualquier compra confirmada (incluye pagos CxP de
      // compras anteriores).
      this.prisma.pagoCompra.aggregate({
        _sum: { monto: true },
        where: {
          anulado: false,
          fechaPago: { gte: desde, lte: hasta },
          compra: { empresaId, ...(sedeId && { sedeId }), estado: 'CONFIRMADA' },
        },
      }),
    ]);

    const totalCompras = compras.reduce((s, c) => s + Number(c.total), 0);
    const totalPagado = Number(pagadoAgg._sum.monto ?? 0);
    const pendientePago = compras.reduce((s, c) => {
      const pagado = c.pagos.reduce((ps, p) => ps + Number(p.monto), 0);
      return s + Math.max(Number(c.total) - pagado, 0);
    }, 0);

    return {
      cantidad: compras.length,
      totalCompras: r2(totalCompras),
      totalPagado: r2(totalPagado),
      pendientePago: r2(pendientePago),
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
    // Dinero ya recibido/validado cuyo pedido AÚN no genera venta interna
    // (la venta nace al ENVIAR; desde ahí el ingreso se cuenta por sus
    // PagoVenta). Sumar totalValidado completo doble-contaría los enviados.
    // CONTRAENTREGA no es dinero recibido: se cobra al entregar (la venta
    // interna registra el pago ahí), así que se excluye de este puente.
    const totalPorFacturar = pedidos
      .filter((p) => ['PAGO_VALIDADO', 'EN_PREPARACION'].includes(p.estado) && p.metodoPago !== 'CONTRAENTREGA')
      .reduce((s, p) => s + Number(p.total), 0);
    const pendientes = pedidos.filter((p) => ['PENDIENTE_PAGO', 'PAGO_ENVIADO'].includes(p.estado));

    return {
      cantidad: pedidos.length,
      totalPedidos: r2(totalPedidos),
      totalValidado: r2(totalValidado),
      totalPorFacturar: r2(totalPorFacturar),
      pedidosPendientes: pendientes.length,
      pedidosEntregados: pedidos.filter((p) => p.estado === 'ENTREGADO').length,
    };
  }

  private async _resumenCuentasCobrar(empresaId: string, sedeId?: string) {
    const ventas = await this.prisma.venta.findMany({
      where: { empresaId, ...(sedeId && { sedeId }), esCredito: true, estado: { notIn: ['ANULADA', 'BORRADOR'] } },
      include: {
        pagos: { where: { anulado: false } },
        cuotas: { where: { estado: { not: 'ANULADA' } } },
      },
    });

    let totalPendiente = 0;
    let totalVencido = 0;
    const now = new Date();

    for (const v of ventas) {
      const saldo = this._saldoVenta(v);
      if (saldo <= 0) continue;

      if (v.cuotas.length > 0) {
        // Con cuotas el vencimiento es POR CUOTA: solo lo vencido cuenta como
        // vencido; el resto del saldo sigue siendo deuda corriente.
        const vencidoCuotas = r2(
          v.cuotas
            .filter((c) => c.fechaVencimiento < now && Number(c.saldoPendiente) > 0)
            .reduce((s, c) => s + Number(c.saldoPendiente), 0),
        );
        totalVencido += Math.min(vencidoCuotas, saldo);
        totalPendiente += Math.max(saldo - vencidoCuotas, 0);
      } else if (v.fechaVencimientoPago && v.fechaVencimientoPago < now) {
        totalVencido += saldo;
      } else {
        totalPendiente += saldo;
      }
    }

    return {
      totalPendiente: r2(totalPendiente),
      totalVencido: r2(totalVencido),
      total: r2(totalPendiente + totalVencido),
    };
  }

  private async _resumenCuentasPagar(empresaId: string, sedeId?: string) {
    const compras = await this.prisma.compra.findMany({
      where: { empresaId, ...(sedeId && { sedeId }), estado: 'CONFIRMADA', terminosPago: { not: 'CONTADO' } },
      include: { pagos: { where: { anulado: false } } },
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
      totalPendiente: r2(totalPendiente),
      totalVencido: r2(totalVencido),
      total: r2(totalPendiente + totalVencido),
    };
  }

  private async _resumenCaja(empresaId: string, sedeId?: string) {
    const cajasAbiertas = await this.prisma.caja.count({
      where: { empresaId, ...(sedeId && { sedeId }), estado: 'ABIERTA', esCajaCentral: false },
    });

    // Movimientos del día — usa inicio del día hora Perú (no UTC).
    // Sin esto el container UTC contaba 19:00-23:59 del día anterior Perú
    // como "hoy" y arrastraba ventas/movs del cierre del día previo.
    const hoy = this._startOfTodayPeru();

    const movimientosHoy = await this.prisma.movimientoCaja.groupBy({
      by: ['tipo'],
      where: {
        empresaId,
        ...(sedeId && { caja: { sedeId } }),
        anulado: false,
        fechaMovimiento: { gte: hoy },
        // Excluir transferencias internas operativa↔central para no
        // doble-contar (el par DEPOSITO_TESORERIA suma ambos lados).
        categoria: { notIn: ['DEPOSITO_TESORERIA', 'RETIRO_TESORERIA'] },
      },
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
      ingresosHoy: r2(ingresosHoy),
      egresosHoy: r2(egresosHoy),
      flujoHoy: r2(ingresosHoy - egresosHoy),
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
      totalSaldo: r2(totalSaldo),
      cuentas: cuentas.map((c) => ({
        ...c,
        saldoActual: c.saldoActual ? Number(c.saldoActual) : null,
      })),
    };
  }

  /**
   * Tesorería (dónde está el EFECTIVO hoy): bóveda(s) = Caja Central por sede,
   * efectivo en cajas operativas abiertas y float de cajas chicas activas.
   * Mismo criterio de saldo que getTesoreriaConsolidado (caja.service).
   */
  private async _resumenTesoreria(empresaId: string, sedeId?: string) {
    const [centrales, abiertas, chicasAgg] = await Promise.all([
      this.prisma.caja.findMany({
        where: { empresaId, ...(sedeId && { sedeId }), esCajaCentral: true },
        select: { id: true },
      }),
      this.prisma.caja.findMany({
        where: { empresaId, ...(sedeId && { sedeId }), estado: 'ABIERTA', esCajaCentral: false },
        select: { id: true, montoApertura: true },
      }),
      this.prisma.cajaChica.aggregate({
        _sum: { saldoActual: true },
        where: { empresaId, ...(sedeId && { sedeId }), estado: 'ACTIVA' },
      }),
    ]);

    // Bóvedas: saldo EFECTIVO = Σ movimientos firmados (la central es
    // perpetua, sin apertura; incluye barridos y retiros de tesorería).
    let saldoBovedas = 0;
    if (centrales.length > 0) {
      const rows = await this.prisma.movimientoCaja.groupBy({
        by: ['tipo'],
        where: {
          cajaId: { in: centrales.map((c) => c.id) },
          anulado: false,
          metodoPago: 'EFECTIVO',
        },
        _sum: { monto: true },
      });
      for (const row of rows) {
        const monto = Number(row._sum.monto ?? 0);
        saldoBovedas += row.tipo === 'INGRESO' ? monto : -monto;
      }
    }

    // Cajas operativas abiertas: apertura + movimientos EFECTIVO (excluyendo
    // el par de transferencia con tesorería, que ya representa la apertura).
    let efectivoCajasAbiertas = abiertas.reduce((s, c) => s + Number(c.montoApertura), 0);
    if (abiertas.length > 0) {
      const rows = await this.prisma.movimientoCaja.groupBy({
        by: ['tipo'],
        where: {
          cajaId: { in: abiertas.map((c) => c.id) },
          anulado: false,
          metodoPago: 'EFECTIVO',
          categoria: { notIn: ['DEPOSITO_TESORERIA', 'RETIRO_TESORERIA'] },
        },
        _sum: { monto: true },
      });
      for (const row of rows) {
        const monto = Number(row._sum.monto ?? 0);
        efectivoCajasAbiertas += row.tipo === 'INGRESO' ? monto : -monto;
      }
    }

    return {
      saldoBovedas: r2(saldoBovedas),
      efectivoCajasAbiertas: r2(efectivoCajasAbiertas),
      saldoCajaChica: r2(Number(chicasAgg._sum.saldoActual ?? 0)),
    };
  }

  /**
   * Datos diarios para gráfico de ingresos vs egresos
   */
  async getGraficoDiario(empresaId: string, fechaDesde?: string, fechaHasta?: string, sedeId?: string) {
    const desde = this._parseFecha(fechaDesde, false) ?? this._inicioMes();
    const hasta = this._parseFecha(fechaHasta, true) ?? new Date();

    const [movimientos, pagosBanco] = await Promise.all([
      this.prisma.movimientoCaja.findMany({
        where: {
          empresaId,
          ...(sedeId && { caja: { sedeId } }),
          anulado: false,
          fechaMovimiento: { gte: desde, lte: hasta },
          // Excluir transferencias internas (par espejo operativa↔central).
          categoria: { notIn: ['DEPOSITO_TESORERIA', 'RETIRO_TESORERIA'] },
        },
        select: { tipo: true, monto: true, fechaMovimiento: true },
        orderBy: { fechaMovimiento: 'asc' },
      }),
      // Pagos de gasto recurrente por BANCO (no generan MovimientoCaja)
      this.prisma.pagoGastoRecurrente.findMany({
        where: {
          empresaId,
          fuente: 'BANCO',
          anulado: false,
          fechaPago: { gte: desde, lte: hasta },
          ...(sedeId && { gastoRecurrente: { sedeId } }),
        },
        select: { montoReal: true, fechaPago: true },
      }),
    ]);

    // Agrupar por día CALENDARIO PERÚ (no UTC: un ingreso de las 20:00 Lima
    // es 01:00 UTC del día siguiente y caía en la barra equivocada).
    const porDia = new Map<string, { fecha: string; ingresos: number; egresos: number }>();

    for (const m of movimientos) {
      const dia = this._ymdPeru(m.fechaMovimiento);
      if (!porDia.has(dia)) {
        porDia.set(dia, { fecha: dia, ingresos: 0, egresos: 0 });
      }
      const d = porDia.get(dia)!;
      if (m.tipo === 'INGRESO') d.ingresos += Number(m.monto);
      else d.egresos += Number(m.monto);
    }

    for (const p of pagosBanco) {
      const dia = this._ymdPeru(p.fechaPago);
      if (!porDia.has(dia)) {
        porDia.set(dia, { fecha: dia, ingresos: 0, egresos: 0 });
      }
      porDia.get(dia)!.egresos += Number(p.montoReal);
    }

    // Llenar días sin movimientos (iterando en días calendario Perú).
    const result: any[] = [];
    const current = new Date(desde);
    const diaHasta = this._ymdPeru(hasta);
    let dia = this._ymdPeru(current);
    while (dia <= diaHasta) {
      const data = porDia.get(dia) ?? { fecha: dia, ingresos: 0, egresos: 0 };
      result.push({
        fecha: dia,
        ingresos: r2(data.ingresos),
        egresos: r2(data.egresos),
      });
      current.setDate(current.getDate() + 1);
      dia = this._ymdPeru(current);
    }

    return result;
  }

  private async _resumenPrestamos(empresaId: string, desde: Date, hasta: Date) {
    const prestamos = await this.prisma.prestamo.findMany({
      where: { empresaId, estado: { in: ['ACTIVO', 'VENCIDO'] } },
      include: { pagos: true },
    });

    const totalDeuda = prestamos.reduce((s, p) => s + Number(p.saldoPendiente), 0);
    const totalOriginal = prestamos.reduce((s, p) => s + Number(p.montoOriginal), 0);
    const totalPagado = prestamos.reduce((s, p) => s + Number(p.totalPagado), 0);

    // Pagos DEL PERÍODO consultado (antes usaba siempre inicio de mes, y con
    // un rango custom los egresos por préstamo no calzaban con el período).
    const totalPagadoPeriodo = prestamos.reduce((s, p) => {
      return s + p.pagos
        .filter((pg) => pg.fechaPago >= desde && pg.fechaPago <= hasta)
        .reduce((ps, pg) => ps + Number(pg.monto), 0);
    }, 0);

    return {
      cantidadActivos: prestamos.length,
      totalDeuda: r2(totalDeuda),
      totalOriginal: r2(totalOriginal),
      totalPagado: r2(totalPagado),
      totalPagadoPeriodo: r2(totalPagadoPeriodo),
      porcentajePagado: totalOriginal > 0 ? Math.round((totalPagado / totalOriginal) * 100) : 0,
    };
  }

  /**
   * Resumen de movimientos de caja que no se cuentan en otras secciones.
   *
   * INGRESOS puros: OTRO_INGRESO, COMISION_AGENTE.
   * EGRESOS reales: GASTO_OPERATIVO, OTRO_EGRESO, DEVOLUCION, PAGO_PLANILLA,
   * ADELANTO_EMPLEADO, BONIFICACION_EMPLEADO y REPOSICION_CAJA_CHICA (la
   * reposición desde bóveda es el rastro contable de los gastos rendidos de
   * caja chica — esos gastos no generan MovimientoCaja propio).
   * AJUSTE_TESORERIA entra con su signo (corrección real de bóveda).
   *
   * FUERA a propósito: VENTA/PEDIDO_MARKETPLACE/COMPRA/PAGO_PROVEEDOR (se
   * cuentan por PagoVenta/PagoCompra), DEPOSITO/RETIRO_TESORERIA y
   * DEPOSITO/RETIRO_AGENTE (neutros), REVERSO_CAJA_CERRADA (el pago original
   * queda anulado, contarlo doble-restaría) y los ADELANTOS de servicio y
   * cotización (se cuentan cuando se convierten en PagoVenta — política
   * "un sol se cuenta una vez").
   */
  private async _resumenOtrosMovimientos(empresaId: string, desde: Date, hasta: Date, sedeId?: string) {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        ...(sedeId && { caja: { sedeId } }),
        anulado: false,
        fechaMovimiento: { gte: desde, lte: hasta },
        categoria: {
          in: [
            'OTRO_INGRESO',
            'COMISION_AGENTE',
            'GASTO_OPERATIVO',
            'OTRO_EGRESO',
            'DEVOLUCION',
            'PAGO_PLANILLA',
            'ADELANTO_EMPLEADO',
            'BONIFICACION_EMPLEADO',
            'REPOSICION_CAJA_CHICA',
            'AJUSTE_TESORERIA',
          ],
        },
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
      totalOtrosIngresos: r2(totalOtrosIngresos),
      totalOtrosEgresos: r2(totalOtrosEgresos),
      porCategoria,
    };
  }

  private async _resumenAgentes(empresaId: string, desde?: Date, hasta?: Date, sedeId?: string) {
    const where: any = { empresaId, anulado: false };
    if (sedeId) where.agenteBancario = { sedeId };
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
      totalDepositos: r2(depositos.reduce((s, o) => s + Number(o.monto), 0)),
      totalRetiros: r2(retiros.reduce((s, o) => s + Number(o.monto), 0)),
      cantidadDepositos: depositos.length,
      cantidadRetiros: retiros.length,
      comisionesGanadas: r2(operaciones.reduce((s, o) => s + Number(o.comision), 0)),
    };
  }

  /**
   * Pagos de gastos recurrentes con fuente=BANCO en el período.
   * NO genera MovimientoCaja (solo decrementa EmpresaBanco.saldoActual), así
   * que sin este resumen los reportes de egresos del mes se quedarían cortos.
   * Los pagos con fuente=CAJA ya entran vía MovimientoCaja en _resumenOtrosMovimientos.
   */
  private async _resumenGastosRecurrentesBanco(empresaId: string, desde: Date, hasta: Date, sedeId?: string) {
    const pagos = await this.prisma.pagoGastoRecurrente.findMany({
      where: {
        empresaId,
        fuente: 'BANCO',
        anulado: false,
        fechaPago: { gte: desde, lte: hasta },
        // Con sede: solo gastos de ESA sede. Los globales (sedeId null) son de
        // la empresa entera y solo aparecen en la vista "Todas las sedes".
        ...(sedeId && { gastoRecurrente: { sedeId } }),
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
      totalPagosBanco: r2(totalPagosBanco),
      porCategoria,
    };
  }

  /**
   * Normaliza una fecha del query. Si viene date-only ('YYYY-MM-DD', lo que
   * manda el picker del app) se interpreta como día calendario PERÚ completo:
   * desde = 00:00 Lima, hasta = 23:59:59.999 Lima. Sin esto, 'hasta' caía a
   * las 00:00 UTC y cortaba el último día entero del rango.
   */
  private _parseFecha(s: string | undefined, endOfDay: boolean): Date | null {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-05:00`);
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /// Fecha 'YYYY-MM-DD' de un instante en zona Perú.
  private _ymdPeru(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }

  /// Inicio del día ACTUAL en zona Perú (America/Lima, UTC-5) expresado en
  /// UTC. El container corre en UTC; sin esto, `new Date()` + `setHours(0)`
  /// daba 00:00 UTC = 19:00 hora Perú del día anterior, y filtros tipo
  /// "ingresos de hoy" arrastraban ventas de la tarde-noche del día previo.
  private _startOfTodayPeru(): Date {
    const ymd = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Lima',
    });
    // Perú = UTC-5 sin DST. 00:00 hora Perú = 05:00 UTC del mismo día.
    return new Date(`${ymd}T05:00:00.000Z`);
  }

  private _inicioMes(): Date {
    const ymd = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Lima',
    });
    // ymd = 'YYYY-MM-DD' en Perú → primer día del mes Perú en UTC.
    const [y, m] = ymd.split('-');
    return new Date(`${y}-${m}-01T05:00:00.000Z`);
  }
}
