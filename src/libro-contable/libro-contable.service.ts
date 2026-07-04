import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AsientoContable {
  fecha: Date;
  tipo: 'INGRESO' | 'EGRESO';
  categoria: string;
  descripcion: string;
  monto: number;
  referencia: string | null;
  saldoAcumulado: number;
}

@Injectable()
export class LibroContableService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene el libro contable (todos los movimientos financieros) de un mes/anio.
   *
   * CRITERIO: DEVENGADO y "un sol se cuenta UNA vez" (misma política que el
   * resumen financiero):
   * - Ventas y compras entran por su TOTAL en su fecha (aunque sean a crédito).
   * - Por eso los PAGOS de esas deudas (PAGO_PROVEEDOR, abonos CxC) y los
   *   ADELANTOS que luego se convierten en venta NO entran por caja: ya están
   *   (o estarán) contados en su documento.
   */
  async getLibro(empresaId: string, mes: number, anio: number, sedeId?: string) {
    // Mes calendario PERÚ. `new Date(anio, mes-1, 1)` corría en TZ del server
    // (UTC): el mes arrancaba a las 19:00 Perú del día anterior y cortaba las
    // ventas de la noche del último día.
    const mm = String(mes).padStart(2, '0');
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const fechaInicio = new Date(`${anio}-${mm}-01T00:00:00.000-05:00`);
    const fechaFin = new Date(`${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}T23:59:59.999-05:00`);

    const [ventas, compras, movimientosCaja, pagosPrestamo, pagosGastoRecurrenteBanco] = await Promise.all([
      this._getVentas(empresaId, fechaInicio, fechaFin, sedeId),
      this._getCompras(empresaId, fechaInicio, fechaFin, sedeId),
      this._getMovimientosCaja(empresaId, fechaInicio, fechaFin, sedeId),
      // Préstamos son de EMPRESA (sin sede): con sede filtrada quedan fuera
      // para no atribuirle a una sede deuda de toda la empresa.
      sedeId ? Promise.resolve([]) : this._getPagosPrestamo(empresaId, fechaInicio, fechaFin),
      this._getPagosGastoRecurrenteBanco(empresaId, fechaInicio, fechaFin, sedeId),
    ]);

    // Unificar en lista de asientos
    const asientos: AsientoContable[] = [
      ...ventas,
      ...compras,
      ...movimientosCaja,
      ...pagosPrestamo,
      ...pagosGastoRecurrenteBanco,
    ];

    // Ordenar cronologicamente
    asientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    // Calcular saldo acumulado
    let saldoAcumulado = 0;
    for (const asiento of asientos) {
      if (asiento.tipo === 'INGRESO') {
        saldoAcumulado += asiento.monto;
      } else {
        saldoAcumulado -= asiento.monto;
      }
      asiento.saldoAcumulado = Math.round(saldoAcumulado * 100) / 100;
    }

    const totalIngresos = asientos
      .filter((a) => a.tipo === 'INGRESO')
      .reduce((sum, a) => sum + a.monto, 0);

    const totalEgresos = asientos
      .filter((a) => a.tipo === 'EGRESO')
      .reduce((sum, a) => sum + a.monto, 0);

    return {
      periodo: { mes, anio },
      asientos,
      resumen: {
        totalIngresos: Math.round(totalIngresos * 100) / 100,
        totalEgresos: Math.round(totalEgresos * 100) / 100,
        saldo: Math.round((totalIngresos - totalEgresos) * 100) / 100,
      },
    };
  }

  private async _getVentas(
    empresaId: string,
    desde: Date,
    hasta: Date,
    sedeId?: string,
  ): Promise<AsientoContable[]> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        ...(sedeId && { sedeId }),
        fechaVenta: { gte: desde, lte: hasta },
        // BORRADOR fuera: las ventas Yape diferidas nacen BORRADOR y pueden
        // cancelarse sin cobrarse — no son ingresos todavía.
        estado: { notIn: ['ANULADA', 'BORRADOR'] },
      },
      select: {
        id: true,
        codigo: true,
        total: true,
        fechaVenta: true,
        nombreCliente: true,
      },
      orderBy: { fechaVenta: 'asc' },
    });

    return ventas.map((v) => ({
      fecha: v.fechaVenta,
      tipo: 'INGRESO' as const,
      categoria: 'VENTA',
      descripcion: `Venta ${v.codigo} - ${v.nombreCliente}`,
      monto: Number(v.total),
      referencia: v.codigo,
      saldoAcumulado: 0,
    }));
  }

  private async _getCompras(
    empresaId: string,
    desde: Date,
    hasta: Date,
    sedeId?: string,
  ): Promise<AsientoContable[]> {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        ...(sedeId && { sedeId }),
        fechaRecepcion: { gte: desde, lte: hasta },
        estado: 'CONFIRMADA',
      },
      select: {
        id: true,
        codigo: true,
        total: true,
        fechaRecepcion: true,
        nombreProveedor: true,
      },
      orderBy: { fechaRecepcion: 'asc' },
    });

    return compras.map((c) => ({
      fecha: c.fechaRecepcion,
      tipo: 'EGRESO' as const,
      categoria: 'COMPRA',
      descripcion: `Compra ${c.codigo} - ${c.nombreProveedor}`,
      monto: Number(c.total),
      referencia: c.codigo,
      saldoAcumulado: 0,
    }));
  }

  /**
   * Etiquetas legibles para categorías de movimientos de caja
   */
  private static readonly CATEGORIA_LABELS: Record<string, string> = {
    COMISION_AGENTE: 'Comisión Agente Bancario',
    GASTO_OPERATIVO: 'Gasto Operativo',
    OTRO_INGRESO: 'Otro Ingreso',
    OTRO_EGRESO: 'Otro Egreso',
    DEVOLUCION: 'Devolución',
    PAGO_PLANILLA: 'Pago de Planilla',
    ADELANTO_EMPLEADO: 'Adelanto a Empleado',
    BONIFICACION_EMPLEADO: 'Bonificación a Empleado',
    REPOSICION_CAJA_CHICA: 'Reposición Caja Chica (gastos rendidos)',
    AJUSTE_TESORERIA: 'Ajuste de Tesorería',
  };

  /**
   * Movimientos de caja que representan un hecho contable PROPIO (no cubierto
   * por ventas/compras). Exclusiones y su porqué (criterio devengado):
   * - VENTA / COMPRA: ya entran por sus tablas.
   * - PAGO_PROVEEDOR: pagar la deuda de una compra ya contada no es gasto nuevo.
   * - PEDIDO_MARKETPLACE: al ENVIAR el pedido nace su venta interna (contada).
   * - ADELANTO_SERVICIO / ADELANTO_COTIZACION (+ devolución): se cuentan
   *   cuando se convierten en venta.
   * - DEPOSITO/RETIRO_AGENTE: plata de TERCEROS (capital de trabajo del
   *   agente), no ingreso/gasto de la empresa — la ganancia real es
   *   COMISION_AGENTE, que sí cuenta. Antes inflaban ingresos Y egresos.
   * - DEPOSITO/RETIRO_TESORERIA: transferencias internas operativa↔central.
   * - REVERSO_CAJA_CERRADA: reverso de asientos que ya salieron del libro
   *   (venta anulada / pago compra no contado) — contarlo doble-restaría.
   * SÍ cuentan: DEVOLUCION (netea una venta viva), gastos operativos y de
   * planilla, reposición de caja chica (rastro de sus gastos rendidos),
   * comisiones de agente, otros ingresos/egresos y ajustes de tesorería.
   */
  private async _getMovimientosCaja(
    empresaId: string,
    desde: Date,
    hasta: Date,
    sedeId?: string,
  ): Promise<AsientoContable[]> {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        ...(sedeId && { caja: { sedeId } }),
        anulado: false,
        fechaMovimiento: { gte: desde, lte: hasta },
        categoria: {
          notIn: [
            'VENTA',
            'COMPRA',
            'PAGO_PROVEEDOR',
            'PEDIDO_MARKETPLACE',
            'ADELANTO_SERVICIO',
            'ADELANTO_COTIZACION',
            'DEVOLUCION_ADELANTO_COTIZACION',
            'DEPOSITO_AGENTE',
            'RETIRO_AGENTE',
            'DEPOSITO_TESORERIA',
            'RETIRO_TESORERIA',
            'REVERSO_CAJA_CERRADA',
          ],
        },
      },
      select: {
        id: true,
        tipo: true,
        categoria: true,
        monto: true,
        descripcion: true,
        fechaMovimiento: true,
        esManual: true,
      },
      orderBy: { fechaMovimiento: 'asc' },
    });

    return movimientos.map((m) => {
      const label = LibroContableService.CATEGORIA_LABELS[m.categoria] ?? m.categoria;
      return {
        fecha: m.fechaMovimiento,
        tipo: m.tipo as 'INGRESO' | 'EGRESO',
        categoria: `CAJA_${m.categoria}`,
        descripcion: m.descripcion ?? `${m.esManual ? 'Manual' : 'Automático'} - ${label}`,
        monto: Number(m.monto),
        referencia: m.id,
        saldoAcumulado: 0,
      };
    });
  }

  private async _getPagosPrestamo(
    empresaId: string,
    desde: Date,
    hasta: Date,
  ): Promise<AsientoContable[]> {
    const pagos = await this.prisma.pagoPrestamo.findMany({
      where: {
        fechaPago: { gte: desde, lte: hasta },
        prestamo: { empresaId },
      },
      include: {
        prestamo: {
          select: { entidadPrestamo: true, tipo: true },
        },
      },
      orderBy: { fechaPago: 'asc' },
    });

    return pagos.map((p) => ({
      fecha: p.fechaPago,
      tipo: 'EGRESO' as const,
      categoria: 'PAGO_PRESTAMO',
      descripcion: `Pago prestamo ${p.prestamo.tipo} - ${p.prestamo.entidadPrestamo}`,
      monto: Number(p.monto),
      referencia: p.referencia,
      saldoAcumulado: 0,
    }));
  }

  /**
   * Pagos de gastos recurrentes pagados por BANCO. Los pagos por CAJA ya entran
   * vía _getMovimientosCaja porque crean MovimientoCaja con categoría
   * GASTO_OPERATIVO. Sin esto, el libro contable subestimaría los egresos
   * pagados por transferencia bancaria.
   */
  private async _getPagosGastoRecurrenteBanco(
    empresaId: string,
    desde: Date,
    hasta: Date,
    sedeId?: string,
  ): Promise<AsientoContable[]> {
    const pagos = await this.prisma.pagoGastoRecurrente.findMany({
      where: {
        empresaId,
        fuente: 'BANCO',
        anulado: false,
        fechaPago: { gte: desde, lte: hasta },
        // Con sede: solo gastos de esa sede (los globales, sedeId null, son
        // de la empresa entera y solo aparecen en la vista "Toda la empresa").
        ...(sedeId && { gastoRecurrente: { sedeId } }),
      },
      include: {
        gastoRecurrente: { select: { nombre: true } },
        banco: { select: { nombreBanco: true } },
      },
      orderBy: { fechaPago: 'asc' },
    });

    return pagos.map((p) => ({
      fecha: p.fechaPago,
      tipo: 'EGRESO' as const,
      categoria: 'GASTO_RECURRENTE_BANCO',
      descripcion: `${p.gastoRecurrente.nombre} (${p.periodo}) — ${p.banco?.nombreBanco ?? 'banco'}`,
      monto: Number(p.montoReal),
      referencia: p.id,
      saldoAcumulado: 0,
    }));
  }
}
