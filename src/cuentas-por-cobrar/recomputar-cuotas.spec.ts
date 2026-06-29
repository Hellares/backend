import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';

/**
 * Regresión de `_recomputarCuotas` (usado por anularAbono).
 *
 * Bug (reproducido en beta 2026-06-29): en el modelo viejo de crédito con
 * adelanto las cuotas cubren solo la parte financiada (Σ cuotas < total). El
 * adelanto (= total − Σ cuotas) se pagó upfront y NO debe imputarse a las
 * cuotas. El recompute reaplicaba TODOS los pagos a las cuotas, imputando el
 * adelanto y bajando el saldo de más (200 → 150 → 100 tras anular, debía ser 200).
 */
describe('CuentasPorCobrarService._recomputarCuotas (adelanto no financiado)', () => {
  const FUTURO = new Date('2026-12-01');

  /**
   * Arma un `tx` mock y corre _recomputarCuotas. Devuelve un map de los
   * saldos finales por cuota (lo último que se persistió con cuotaVenta.update).
   */
  async function recompute(opts: {
    total: number;
    cuotas: Array<{ id: string; monto: number }>;
    pagosNoAnulados: Array<{ id: string; monto: number; fechaPago: Date }>;
  }) {
    const saldosFinales: Record<string, number> = {};
    const estadosFinales: Record<string, string> = {};
    let estadoVenta = '';
    let montoRecibido = 0;

    const tx: any = {
      cuotaVenta: {
        findMany: jest.fn().mockResolvedValue(
          opts.cuotas.map((c) => ({
            id: c.id,
            monto: c.monto,
            montoPrincipal: c.monto,
            montoInteres: 0,
            montoPagadoPrincipal: 0,
            montoPagadoInteres: 0,
            montoPagadoMora: 0,
            montoMora: 0,
            fechaVencimiento: FUTURO,
            estado: 'PENDIENTE',
          })),
        ),
        update: jest.fn().mockImplementation(({ where, data }) => {
          saldosFinales[where.id] = data.saldoPendiente;
          estadosFinales[where.id] = data.estado;
          return Promise.resolve({});
        }),
      },
      pagoVenta: {
        findMany: jest.fn().mockResolvedValue(opts.pagosNoAnulados),
        update: jest.fn().mockResolvedValue({}),
      },
      venta: {
        findUnique: jest.fn().mockResolvedValue({ total: opts.total, totalConInteres: null }),
        update: jest.fn().mockImplementation(({ data }) => {
          estadoVenta = data.estado;
          montoRecibido = data.montoRecibido;
          return Promise.resolve({});
        }),
      },
      configuracionEmpresa: {
        findFirst: jest.fn().mockResolvedValue(null), // sin mora
      },
    };

    const service = new CuentasPorCobrarService({} as any, {} as any);
    await (service as any)._recomputarCuotas(tx, 'emp-1', 'venta-1');
    const sumaSaldos =
      Math.round(Object.values(saldosFinales).reduce((s, v) => s + v, 0) * 100) / 100;
    return { saldosFinales, estadosFinales, estadoVenta, montoRecibido, sumaSaldos };
  }

  it('modelo VIEJO con adelanto (Σcuotas<total): el adelanto NO se imputa a cuotas', async () => {
    // total 300, 2 cuotas de 100 (financiado=200), adelanto 100 (único pago vigente,
    // el abono fue anulado). Tras recompute el saldo debe ser 200, no 100.
    const r = await recompute({
      total: 300,
      cuotas: [
        { id: 'c1', monto: 100 },
        { id: 'c2', monto: 100 },
      ],
      pagosNoAnulados: [{ id: 'adelanto', monto: 100, fechaPago: new Date('2026-06-20') }],
    });
    expect(r.saldosFinales['c1']).toBe(100); // NO 0 (el bug imputaba el adelanto)
    expect(r.saldosFinales['c2']).toBe(100);
    expect(r.sumaSaldos).toBe(200);
    expect(r.estadoVenta).toBe('PAGADA_PARCIAL');
    expect(r.montoRecibido).toBe(100);
  });

  it('modelo VIEJO: adelanto 100 + abono real 50 → saldo 150 (adelanto excluido, abono sí)', async () => {
    const r = await recompute({
      total: 300,
      cuotas: [
        { id: 'c1', monto: 100 },
        { id: 'c2', monto: 100 },
      ],
      pagosNoAnulados: [
        { id: 'adelanto', monto: 100, fechaPago: new Date('2026-06-20') },
        { id: 'abono', monto: 50, fechaPago: new Date('2026-06-25') },
      ],
    });
    expect(r.sumaSaldos).toBe(150); // 200 financiado − 50 del abono real
  });

  it('modelo NUEVO (Σcuotas=total): el adelanto SÍ se imputa a cuotas (sin cambio de conducta)', async () => {
    // total 200, 2 cuotas de 100 (Σ=total) → adelantoNoFinanciado=0 → el pago de
    // 100 se imputa normal a la cuota 1.
    const r = await recompute({
      total: 200,
      cuotas: [
        { id: 'c1', monto: 100 },
        { id: 'c2', monto: 100 },
      ],
      pagosNoAnulados: [{ id: 'pago1', monto: 100, fechaPago: new Date('2026-06-20') }],
    });
    expect(r.saldosFinales['c1']).toBe(0); // cuota 1 pagada
    expect(r.saldosFinales['c2']).toBe(100);
    expect(r.sumaSaldos).toBe(100);
  });
});
