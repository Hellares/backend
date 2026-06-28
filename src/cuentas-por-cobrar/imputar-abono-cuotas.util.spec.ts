import {
  imputarEnCuotas,
  CuotaImputable,
  ConfigMoraImputacion,
} from './imputar-abono-cuotas.util';

const SIN_MORA: ConfigMoraImputacion = {
  moraHabilitada: false,
  porcentajeMoraDiario: 0.05,
  moraMaximaPorcentaje: 30,
  diasGraciaMora: 0,
};

function cuota(over: Partial<CuotaImputable> = {}): CuotaImputable {
  return {
    id: 'c1',
    monto: 100,
    montoPrincipal: 100,
    montoInteres: 0,
    montoPagadoPrincipal: 0,
    montoPagadoInteres: 0,
    montoPagadoMora: 0,
    fechaVencimiento: new Date('2026-01-01'),
    estado: 'PENDIENTE',
    ...over,
  };
}

describe('imputarEnCuotas', () => {
  const ahora = new Date('2026-01-01'); // no vencido → sin mora

  it('pago total de 1 cuota → PAGADA, todo a principal', () => {
    const cuotas = [cuota()];
    const res = imputarEnCuotas(cuotas, 100, SIN_MORA, ahora);
    expect(res.updates).toHaveLength(1);
    expect(res.updates[0].estado).toBe('PAGADA');
    expect(res.updates[0].pagada).toBe(true);
    expect(res.updates[0].saldoPendiente).toBe(0);
    expect(res.breakdown).toEqual({ principal: 100, interes: 0, mora: 0 });
    expect(res.aplicadoTotal).toBe(100);
  });

  it('pago parcial → PAGADA_PARCIAL con saldo restante', () => {
    const res = imputarEnCuotas([cuota()], 40, SIN_MORA, ahora);
    expect(res.updates[0].estado).toBe('PAGADA_PARCIAL');
    expect(res.updates[0].saldoPendiente).toBe(60);
    expect(res.breakdown.principal).toBe(40);
    expect(res.aplicadoTotal).toBe(40);
  });

  it('cascada interés → principal dentro de una cuota', () => {
    // cuota 100 = 80 principal + 20 interés. Pago 30 → 20 interés + 10 principal.
    const res = imputarEnCuotas(
      [cuota({ monto: 100, montoPrincipal: 80, montoInteres: 20 })],
      30,
      SIN_MORA,
      ahora,
    );
    expect(res.breakdown.interes).toBe(20);
    expect(res.breakdown.principal).toBe(10);
    expect(res.updates[0].montoPagadoInteres).toBe(20);
    expect(res.updates[0].montoPagadoPrincipal).toBe(10);
    expect(res.updates[0].estado).toBe('PAGADA_PARCIAL');
  });

  it('mora primero cuando la cuota está vencida', () => {
    // cuota 100 principal, vencida 10 días, mora 0.05%/día = 0.5% → 0.5
    const vencida = cuota({ fechaVencimiento: new Date('2026-01-01') });
    const config: ConfigMoraImputacion = { ...SIN_MORA, moraHabilitada: true };
    const ahoraVencido = new Date('2026-01-11'); // +10 días
    const res = imputarEnCuotas([vencida], 0.5, config, ahoraVencido);
    expect(res.breakdown.mora).toBeCloseTo(0.5, 2);
    expect(res.breakdown.principal).toBe(0);
    expect(res.updates[0].montoPagadoMora).toBeCloseTo(0.5, 2);
  });

  it('pago que cubre 2 cuotas (cascada entre cuotas)', () => {
    const cuotas = [
      cuota({ id: 'c1', monto: 50, montoPrincipal: 50 }),
      cuota({ id: 'c2', monto: 50, montoPrincipal: 50 }),
    ];
    const res = imputarEnCuotas(cuotas, 70, SIN_MORA, ahora);
    expect(res.updates).toHaveLength(2);
    expect(res.updates[0].estado).toBe('PAGADA'); // c1 completa
    expect(res.updates[1].estado).toBe('PAGADA_PARCIAL'); // c2 parcial 20
    expect(res.updates[1].saldoPendiente).toBe(30);
    expect(res.breakdown.principal).toBe(70);
    expect(res.aplicadoTotal).toBe(70);
  });

  it('monto mayor al saldo total → solo aplica lo que hay (no infla)', () => {
    const res = imputarEnCuotas([cuota({ monto: 50, montoPrincipal: 50 })], 80, SIN_MORA, ahora);
    expect(res.aplicadoTotal).toBe(50);
    expect(res.breakdown.principal).toBe(50);
    expect(res.updates[0].estado).toBe('PAGADA');
  });

  it('reaplicación sucesiva (simula recompute): dos abonos sobre el mismo estado', () => {
    const cuotas = [cuota({ monto: 100, montoPrincipal: 100 })];
    imputarEnCuotas(cuotas, 30, SIN_MORA, ahora); // muta cuotas en memoria
    const res2 = imputarEnCuotas(cuotas, 30, SIN_MORA, ahora);
    // tras 2 abonos de 30, pagado 60, saldo 40
    expect(res2.updates[0].saldoPendiente).toBe(40);
    expect(res2.updates[0].montoPagadoPrincipal).toBe(60);
  });
});
