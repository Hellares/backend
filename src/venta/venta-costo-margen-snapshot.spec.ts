import { VentaService } from './venta.service';

/**
 * Snapshots de costo y margen de una línea de venta.
 *
 * Los dos son valores POR UNIDAD DE VENTA, no montos, y se guardaban con
 * `round2`. Para cualquier producto en unidad chica eso los destruye: un granel
 * en gramos cuesta 0.009933/g y quedaba en 0.01, pero lo grave era el margen —
 * 0.001067 colapsa a 0.00, así que TODA venta a granel se reportaba con margen
 * cero y el guard de venta bajo costo, que busca `margenSnapshot < 0`, dejaba
 * de ver las pérdidas sub-céntimo.
 *
 * Visto en beta en la venta VTA-SED-00000781: 5 kg de granel a S/11/kg
 * guardaron `precioCostoSnapshot 0.010000` y `margenSnapshot 0.000000`.
 *
 * `calcularDetalle` es puro y no toca `this`, así que se invoca por prototype
 * sin construir el servicio (que tiene una docena de dependencias).
 */
const calcular = (dto: any) =>
  (VentaService.prototype as any).calcularDetalle.call(null, dto, 0);

/** Granel: se guarda en gramos, se cobra en kilos. */
const LINEA_GRANEL = {
  descripcion: 'ALIMENTO / GRANEL',
  cantidad: 5000,
  precioUnitario: 0.011,
  descuento: 0,
  porcentajeIGV: 18,
  precioIncluyeIgv: true,
  precioCostoSnapshot: 0.009933,
};

describe('snapshot de costo y margen por unidad de venta', () => {
  it('🔴 conserva el costo sub-céntimo en vez de redondearlo a 0.01', () => {
    const d = calcular(LINEA_GRANEL);

    expect(d.precioCostoSnapshot).toBeCloseTo(0.009933, 6);
  });

  it('🔴 el margen de un granel deja de ser cero', () => {
    const d = calcular(LINEA_GRANEL);

    // 0.011 − 0.009933 = 0.001067 por gramo. Con round2 daba 0.
    expect(d.margenSnapshot).toBeCloseTo(0.001067, 6);
    expect(d.margenSnapshot).toBeGreaterThan(0);
  });

  it('una pérdida sub-céntimo sigue siendo NEGATIVA y el guard la ve', () => {
    // Vender a 0.0095 el gramo estando el costo en 0.009933 es pérdida. Con
    // round2 el margen daba 0.00 y `margenSnapshot < 0` no la detectaba.
    const d = calcular({ ...LINEA_GRANEL, precioUnitario: 0.0095 });

    expect(d.margenSnapshot).toBeLessThan(0);
  });

  it('los MONTOS de la línea siguen en 2 decimales', () => {
    const d = calcular(LINEA_GRANEL);

    // 5000 × 0.011 = 55.00 con IGV incluido.
    expect(d.total).toBe(55);
    expect(d.subtotal).toBe(46.61);
    expect(d.igv).toBe(8.39);
  });

  it('un producto por unidad no cambia: el costo entero queda igual', () => {
    const d = calcular({
      descripcion: 'SACO 15KG',
      cantidad: 2,
      precioUnitario: 160,
      descuento: 0,
      porcentajeIGV: 18,
      precioIncluyeIgv: true,
      precioCostoSnapshot: 149,
    });

    expect(d.precioCostoSnapshot).toBe(149);
    expect(d.margenSnapshot).toBe(11);
    expect(d.total).toBe(320);
  });
});
