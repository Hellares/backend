import { CompraService } from './compra.service';

/**
 * Tests de la lógica pura de compra:
 *  - `calcularDetalle()` (privado): conversión por unidad de compra
 *    (×factor / ÷factor) + cálculo de IGV/subtotal/total. Es el corazón del
 *    feature unidad-de-compra. Se invoca vía prototype (no usa `this`).
 *  - `calcularNuevoCostoPromedio()` (estático): costo promedio ponderado al
 *    recibir una compra, en unidad atómica, redondeado a 2 decimales.
 *
 * No tocan infra (sin prisma/DB): son funciones puras.
 */

// Acceso al método privado puro (no referencia `this`).
const calcularDetalle = (
  dto: any,
  index: number,
  factoresMap?: Map<string, { factor: number; simboloUnidadCompra: string }>,
  precioIncluyeIgv = true,
) =>
  (CompraService.prototype as any).calcularDetalle.call(
    null,
    dto,
    index,
    factoresMap,
    precioIncluyeIgv,
  );

const mapDe = (
  entradas: Record<string, { factor: number; simbolo: string }>,
) => {
  const m = new Map<string, { factor: number; simboloUnidadCompra: string }>();
  for (const [id, v] of Object.entries(entradas)) {
    m.set(id, { factor: v.factor, simboloUnidadCompra: v.simbolo });
  }
  return m;
};

describe('CompraService.calcularDetalle — unidad base (sin conversión)', () => {
  it('IGV incluido (18%): total = bruto, subtotal e IGV se desglosan', () => {
    const r = calcularDetalle(
      { descripcion: 'X', cantidad: 10, precioUnitario: 5 },
      0,
      undefined,
      true,
    );
    expect(r.cantidad).toBe(10);
    expect(r.precioUnitario).toBe(5);
    expect(r.usaUnidadCompra).toBe(false);
    expect(r.total).toBe(50); // bruto con IGV
    expect(r.subtotal).toBe(42.37); // 50 / 1.18
    expect(r.igv).toBe(7.63);
  });

  it('IGV NO incluido: total = subtotal + IGV', () => {
    const r = calcularDetalle(
      { descripcion: 'X', cantidad: 10, precioUnitario: 5 },
      0,
      undefined,
      false,
    );
    expect(r.subtotal).toBe(50);
    expect(r.igv).toBe(9);
    expect(r.total).toBe(59);
  });

  it('aplica descuento sobre el bruto (IGV incluido)', () => {
    const r = calcularDetalle(
      { descripcion: 'X', cantidad: 10, precioUnitario: 5, descuento: 10 },
      0,
      undefined,
      true,
    );
    expect(r.total).toBe(40); // 50 - 10
    expect(r.subtotal).toBe(33.9); // 40 / 1.18
    expect(r.igv).toBe(6.1);
  });

  it('respeta porcentajeIGV custom (10%)', () => {
    const r = calcularDetalle(
      { descripcion: 'X', cantidad: 10, precioUnitario: 5, porcentajeIGV: 10 },
      0,
      undefined,
      false,
    );
    expect(r.subtotal).toBe(50);
    expect(r.igv).toBe(5);
    expect(r.total).toBe(55);
  });
});

describe('CompraService.calcularDetalle — unidad de compra (conversión ×factor)', () => {
  it('cuero: 10 m × S/5/m, factor 100 → 1000 cm × S/0.05/cm', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Cuero',
        productoId: 'cuero',
        usaUnidadCompra: true,
        cantidad: 10,
        precioUnitario: 5,
      },
      0,
      mapDe({ cuero: { factor: 100, simbolo: 'm' } }),
      true,
    );
    expect(r.cantidad).toBe(1000);
    expect(r.precioUnitario).toBe(0.05);
    expect(r.usaUnidadCompra).toBe(true);
    expect(r.cantidadOriginal).toBe(10);
    expect(r.factorAplicado).toBe(100);
    expect(r.unidadOriginalSimbolo).toBe('m');
    expect(r.total).toBe(50); // 1000 × 0.05
  });

  it('plantas: 1 caja × S/350, factor 50 → 50 par × S/7/par', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Plantas',
        productoId: 'plantas',
        usaUnidadCompra: true,
        cantidad: 1,
        precioUnitario: 350,
      },
      0,
      mapDe({ plantas: { factor: 50, simbolo: 'caja' } }),
      true,
    );
    expect(r.cantidad).toBe(50);
    expect(r.precioUnitario).toBe(7);
    expect(r.total).toBe(350);
  });

  it('lana: 2 kg × S/20/kg, factor 1000 → 2000 g × S/0.02/g', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Lana',
        productoId: 'lana',
        usaUnidadCompra: true,
        cantidad: 2,
        precioUnitario: 20,
      },
      0,
      mapDe({ lana: { factor: 1000, simbolo: 'kg' } }),
      true,
    );
    expect(r.cantidad).toBe(2000);
    expect(r.precioUnitario).toBe(0.02);
    expect(r.total).toBe(40);
  });

  it('precio no exacto: factor 3, precio 10 → 3.3333 (4 decimales)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Y',
        productoId: 'p3',
        usaUnidadCompra: true,
        cantidad: 1,
        precioUnitario: 10,
      },
      0,
      mapDe({ p3: { factor: 3, simbolo: 'tira' } }),
      true,
    );
    expect(r.cantidad).toBe(3);
    expect(r.precioUnitario).toBe(3.3333);
  });

  it('cantidad de compra fraccionaria: 1.5 m × factor 100 → 150 cm (round)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Cuero',
        productoId: 'cuero',
        usaUnidadCompra: true,
        cantidad: 1.5,
        precioUnitario: 5,
      },
      0,
      mapDe({ cuero: { factor: 100, simbolo: 'm' } }),
      true,
    );
    expect(r.cantidad).toBe(150);
    expect(r.precioUnitario).toBe(0.05);
  });

  it('IGV NO incluido se calcula sobre la cantidad ya convertida', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Lana',
        productoId: 'lana',
        usaUnidadCompra: true,
        cantidad: 2,
        precioUnitario: 20,
      },
      0,
      mapDe({ lana: { factor: 1000, simbolo: 'kg' } }),
      false,
    );
    // subtotal = 2000 × 0.02 = 40, igv 18% = 7.2, total 47.2
    expect(r.subtotal).toBe(40);
    expect(r.igv).toBe(7.2);
    expect(r.total).toBe(47.2);
  });
});

describe('CompraService.calcularDetalle — edge / errores', () => {
  it('usaUnidadCompra sin config en factoresMap → BadRequestException', () => {
    expect(() =>
      calcularDetalle(
        {
          descripcion: 'Z',
          productoId: 'sin-config',
          usaUnidadCompra: true,
          cantidad: 1,
          precioUnitario: 10,
        },
        0,
        mapDe({}),
        true,
      ),
    ).toThrow(/unidad de compra/i);
  });

  it('usaUnidadCompra sin productoId → NO convierte (item personalizado)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Servicio',
        usaUnidadCompra: true,
        cantidad: 5,
        precioUnitario: 2,
      },
      0,
      undefined,
      true,
    );
    expect(r.usaUnidadCompra).toBe(false);
    expect(r.cantidad).toBe(5);
    expect(r.precioUnitario).toBe(2);
  });
});

describe('CompraService.calcularNuevoCostoPromedio — costo promedio ponderado', () => {
  it('sin stock previo: el nuevo costo es el de la compra', () => {
    expect(CompraService.calcularNuevoCostoPromedio(0, 0, 100, 5)).toBe(5);
    expect(CompraService.calcularNuevoCostoPromedio(0, 99, 10, 7)).toBe(7);
  });

  it('promedio ponderado con stock previo (redondeo a 2 decimales)', () => {
    // (100×4 + 100×6) / 200 = 5
    expect(CompraService.calcularNuevoCostoPromedio(100, 4, 100, 6)).toBe(5);
    // (100×2.5 + 50×7) / 150 = 4
    expect(CompraService.calcularNuevoCostoPromedio(100, 2.5, 50, 7)).toBe(4);
  });

  it('cuero: 140 cm @ 0.04 + 1000 cm @ 0.05 → 0.05 (2 dec)', () => {
    // (140×0.04 + 1000×0.05) / 1140 = 0.04877 → 0.05
    expect(CompraService.calcularNuevoCostoPromedio(140, 0.04, 1000, 0.05)).toBe(
      0.05,
    );
  });

  it('cuero: 140 cm @ 0.04 + 1 cm @ 0.05 → 0.04 (apenas mueve)', () => {
    // (140×0.04 + 1×0.05) / 141 = 0.0400 → 0.04
    expect(CompraService.calcularNuevoCostoPromedio(140, 0.04, 1, 0.05)).toBe(
      0.04,
    );
  });
});

// --- Crédito en compras (helpers privados; _resolverCredito usa `this`) ---
const _inst = Object.create(CompraService.prototype);
const _dayDiff = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86400000);

describe('CompraService._resolverCredito', () => {
  const base = new Date('2026-01-01T12:00:00Z');

  it('CONTADO: sin días ni vencimiento', () => {
    const r = _inst._resolverCredito({ terminos: 'CONTADO', fechaBase: base });
    expect(r).toEqual({ terminosPago: 'CONTADO', diasCredito: null, fechaVencimientoPago: null });
  });

  it('CREDITO_30: vencimiento = base + 30 días, diasCredito=30', () => {
    const r = _inst._resolverCredito({ terminos: 'CREDITO_30', fechaBase: base });
    expect(r.terminosPago).toBe('CREDITO_30');
    expect(r.diasCredito).toBe(30);
    expect(_dayDiff(r.fechaVencimientoPago, base)).toBe(30);
  });

  it('días explícitos ganan sobre el enum', () => {
    const r = _inst._resolverCredito({ terminos: 'PERSONALIZADO', diasCredito: 45, fechaBase: base });
    expect(r.diasCredito).toBe(45);
    expect(_dayDiff(r.fechaVencimientoPago, base)).toBe(45);
  });

  it('fecha de vencimiento explícita se respeta', () => {
    const r = _inst._resolverCredito({
      terminos: 'CREDITO_30', fechaBase: base, fechaVencimientoExplicita: '2026-03-01',
    });
    expect(r.fechaVencimientoPago.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('crédito sin días ni fecha → lanza', () => {
    expect(() => _inst._resolverCredito({ terminos: 'PERSONALIZADO', fechaBase: base })).toThrow();
  });
});

describe('CompraService._validarLimiteCredito', () => {
  const tx = (compras: any[]) => ({ compra: { findMany: jest.fn().mockResolvedValue(compras) } });

  it('CONTADO no valida (aunque exceda)', async () => {
    await expect(
      _inst._validarLimiteCredito(tx([]), 'e', { id: 'p', limiteCredito: 100 }, 9999, 'CONTADO'),
    ).resolves.toBeUndefined();
  });

  it('proveedor sin límite configurado → no valida', async () => {
    await expect(
      _inst._validarLimiteCredito(tx([]), 'e', { id: 'p', limiteCredito: 0 }, 9999, 'CREDITO_30'),
    ).resolves.toBeUndefined();
  });

  it('deuda + compra dentro del límite → OK', async () => {
    const t = tx([{ total: 500, pagos: [{ monto: 200 }] }]); // deuda 300
    await expect(
      _inst._validarLimiteCredito(t, 'e', { id: 'p', limiteCredito: 1000 }, 600, 'CREDITO_30'),
    ).resolves.toBeUndefined(); // 300+600=900 ≤ 1000
  });

  it('deuda + compra supera el límite → lanza', async () => {
    const t = tx([{ total: 800, pagos: [] }]); // deuda 800
    await expect(
      _inst._validarLimiteCredito(t, 'e', { id: 'p', limiteCredito: 1000 }, 300, 'CREDITO_30'),
    ).rejects.toThrow(/[Ll]ímite de crédito/);
  });
});
