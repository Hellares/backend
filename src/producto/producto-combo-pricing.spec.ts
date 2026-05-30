import { ProductoComboService } from './producto-combo.service';

/**
 * Tests del helper `calcularPreciosFromComponentes` — calcula el precio de un
 * combo a partir de sus componentes. Verifica la precedencia de precio
 * (regla de negocio crítica que tocamos):
 *
 *   liquidación vigente  >  precioEnCombo (override)  >  oferta vigente  >  base
 *
 * con la invariante: "un componente en liquidación NO puede salir más caro
 * dentro del combo que comprándolo suelto" → la liquidación gana SIEMPRE,
 * incluso sobre el override del admin.
 *
 * El helper es puro (no usa `this`), así que lo invocamos sobre el prototype
 * sin instanciar el servicio (que tiene muchas dependencias inyectadas).
 */
describe('ProductoComboService.calcularPreciosFromComponentes', () => {
  const calc: (
    componentes: any[],
  ) => { precioCalculado: number; precioRegularTotal: number } = (
    ProductoComboService.prototype as any
  )['calcularPreciosFromComponentes'].bind({});

  const AYER = new Date(Date.now() - 24 * 3600 * 1000);
  const MANANA = new Date(Date.now() + 24 * 3600 * 1000);

  // Construye un componente con stock para el helper.
  const comp = (opts: {
    precio: number;
    cantidad?: number;
    precioEnCombo?: number | null;
    oferta?: { precio: number; inicio?: Date | null; fin?: Date | null };
    liq?: { precio: number; inicio?: Date | null; fin?: Date | null };
    variante?: boolean;
  }) => {
    const stock = {
      precio: opts.precio,
      enOferta: !!opts.oferta,
      precioOferta: opts.oferta?.precio ?? null,
      fechaInicioOferta: opts.oferta?.inicio ?? null,
      fechaFinOferta: opts.oferta?.fin ?? null,
      enLiquidacion: !!opts.liq,
      precioLiquidacion: opts.liq?.precio ?? null,
      fechaInicioLiquidacion: opts.liq?.inicio ?? null,
      fechaFinLiquidacion: opts.liq?.fin ?? null,
    };
    return {
      cantidad: opts.cantidad ?? 1,
      precioEnCombo: opts.precioEnCombo ?? null,
      ...(opts.variante
        ? { componenteVariante: { stocksPorSede: [stock] } }
        : { componenteProducto: { stocksPorSede: [stock] } }),
    };
  };

  it('precio base puro (sin oferta/liq/override)', () => {
    expect(calc([comp({ precio: 10, cantidad: 2 })])).toEqual({
      precioCalculado: 20,
      precioRegularTotal: 20,
    });
  });

  it('oferta vigente baja el precio efectivo', () => {
    expect(calc([comp({ precio: 10, oferta: { precio: 7 } })])).toEqual({
      precioCalculado: 7,
      precioRegularTotal: 7,
    });
  });

  it('oferta NO baja si es mayor que la base', () => {
    expect(calc([comp({ precio: 10, oferta: { precio: 12 } })])).toEqual({
      precioCalculado: 10,
      precioRegularTotal: 10,
    });
  });

  it('override precioEnCombo se usa en calculado (no en regular) si no hay liquidación', () => {
    expect(calc([comp({ precio: 10, precioEnCombo: 8 })])).toEqual({
      precioCalculado: 8,
      precioRegularTotal: 10,
    });
  });

  it('override gana sobre la oferta (sin liquidación)', () => {
    expect(
      calc([comp({ precio: 10, precioEnCombo: 8, oferta: { precio: 7 } })]),
    ).toEqual({ precioCalculado: 8, precioRegularTotal: 7 });
  });

  it('liquidación vigente gana sobre la base', () => {
    expect(calc([comp({ precio: 10, liq: { precio: 3 } })])).toEqual({
      precioCalculado: 3,
      precioRegularTotal: 3,
    });
  });

  it('liquidación GANA sobre el override (caso PORTA AUDIFONOS: override 5, liq 3)', () => {
    expect(
      calc([comp({ precio: 5, precioEnCombo: 5, liq: { precio: 3 } })]),
    ).toEqual({ precioCalculado: 3, precioRegularTotal: 3 });
  });

  it('liquidación expirada (fechaFin pasada) NO aplica → base', () => {
    expect(
      calc([comp({ precio: 10, liq: { precio: 3, fin: AYER } })]),
    ).toEqual({ precioCalculado: 10, precioRegularTotal: 10 });
  });

  it('liquidación no comenzada (fechaInicio futura) NO aplica → base', () => {
    expect(
      calc([comp({ precio: 10, liq: { precio: 3, inicio: MANANA } })]),
    ).toEqual({ precioCalculado: 10, precioRegularTotal: 10 });
  });

  it('liquidación con ventana vigente (inicio ayer, fin mañana) aplica', () => {
    expect(
      calc([comp({ precio: 10, liq: { precio: 3, inicio: AYER, fin: MANANA } })]),
    ).toEqual({ precioCalculado: 3, precioRegularTotal: 3 });
  });

  it('suma multi-componente: base + liquidación + cantidades', () => {
    // A: base 10 x2 = 20 ; B: liq 3 x1 = 3 → total 23
    const r = calc([
      comp({ precio: 10, cantidad: 2 }),
      comp({ precio: 3, liq: { precio: 3 }, cantidad: 1 }),
    ]);
    expect(r.precioRegularTotal).toBe(23);
    expect(r.precioCalculado).toBe(23);
  });

  it('funciona con variante (componenteVariante)', () => {
    expect(
      calc([comp({ precio: 8, liq: { precio: 4 }, variante: true })]),
    ).toEqual({ precioCalculado: 4, precioRegularTotal: 4 });
  });

  it('componente sin stock → precio 0 (no rompe)', () => {
    expect(calc([{ cantidad: 1, precioEnCombo: null, componenteProducto: {} }]))
      .toEqual({ precioCalculado: 0, precioRegularTotal: 0 });
  });
});
