import {
  imputarEnCuotas,
  moraVigenteCuota,
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
    montoMora: 0,
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

  it('CxC-4: no re-cobra mora ya pagada (neto de montoPagadoMora)', () => {
    // cuota 100 vencida 10 días → mora acumulada 0.5. Si ya se pagó 0.3 de mora,
    // el siguiente abono solo debe imputar 0.2 a mora (no 0.5 de nuevo).
    const config: ConfigMoraImputacion = { ...SIN_MORA, moraHabilitada: true };
    const ahoraVencido = new Date('2026-01-11'); // +10 días
    const c = cuota({ montoPagadoMora: 0.3 });
    const res = imputarEnCuotas([c], 0.2, config, ahoraVencido);
    expect(res.breakdown.mora).toBeCloseTo(0.2, 2);
    expect(res.updates[0].montoPagadoMora).toBeCloseTo(0.5, 2);
  });
});

describe('moraVigenteCuota (fórmula canónica = VentaService/cron)', () => {
  const CON_MORA: ConfigMoraImputacion = {
    moraHabilitada: true,
    porcentajeMoraDiario: 0.05,
    moraMaximaPorcentaje: 30,
    diasGraciaMora: 0,
  };

  it('CxC-5: base = monto de la cuota COMPLETA (incl. interés), no solo principal', () => {
    // monto 120 (100 principal + 20 interés), vencida 10 días, 0.05%/día.
    // canónica: 0.5% de 120 = 0.6 (la vieja, sobre principal=100, daba 0.5).
    const c = cuota({ monto: 120, montoPrincipal: 100, montoInteres: 20 });
    expect(moraVigenteCuota(c, CON_MORA, new Date('2026-01-11'))).toBeCloseTo(0.6, 2);
  });

  it('CxC-5: días vencidos con floor, no ceil (día fraccional no redondea hacia arriba)', () => {
    // 10.5 días → floor 10 → 0.5% de 100 = 0.5 (con ceil(10.5)=11 daría 0.55).
    const c = cuota({ monto: 100, montoPrincipal: 100 });
    expect(
      moraVigenteCuota(c, CON_MORA, new Date('2026-01-11T12:00:00Z')),
    ).toBeCloseTo(0.5, 2);
  });

  it('CxC-4: resta la mora ya pagada (montoPagadoMora)', () => {
    const c = cuota({ monto: 100, montoPrincipal: 100, montoPagadoMora: 0.3 });
    expect(moraVigenteCuota(c, CON_MORA, new Date('2026-01-11'))).toBeCloseTo(0.2, 2);
  });

  it('mora deshabilitada → respeta el montoMora histórico almacenado', () => {
    const c = cuota({ montoMora: 5 });
    expect(moraVigenteCuota(c, SIN_MORA, new Date('2026-12-31'))).toBe(5);
  });

  it('dentro de días de gracia → 0', () => {
    const config = { ...CON_MORA, diasGraciaMora: 15 };
    const c = cuota({ monto: 100, montoPrincipal: 100 });
    expect(moraVigenteCuota(c, config, new Date('2026-01-11'))).toBe(0);
  });
});
