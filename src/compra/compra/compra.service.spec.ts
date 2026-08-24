import { CompraService } from './compra.service';

/**
 * Tests de la lógica pura de compra:
 *  - `calcularDetalle()` (privado): conversión por unidad de compra
 *    (×factor / ÷factor) + cálculo de IGV/subtotal/total. Es el corazón del
 *    feature unidad-de-compra. Se invoca vía prototype (no usa `this`).
 *  - `calcularNuevoCostoPromedio()` (estático): costo promedio ponderado al
 *    recibir una compra, en unidad atómica, redondeado a 6 decimales (es un
 *    precio unitario, no un monto).
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

  it('granel: 1 saco × S/147.99, factor 22 000 → la compra cuadra con la factura', () => {
    // El caso que motivó los 6 decimales. Con 4, el precio por gramo quedaba
    // en 0.0067 y el total volvía como S/147.40: S/0.59 menos que la factura.
    const r = calcularDetalle(
      {
        descripcion: 'RICOCAN 22KG',
        productoId: 'ricocan',
        usaUnidadCompra: true,
        cantidad: 1,
        precioUnitario: 147.99,
      },
      0,
      mapDe({ ricocan: { factor: 22000, simbolo: 'SC' } }),
      true,
    );
    expect(r.cantidad).toBe(22000);
    expect(r.precioUnitario).toBe(0.006727);
    expect(r.total).toBe(147.99);
    // Con IGV incluido: base 125.42 + IGV 22.57 = 147.99. Los tres cierran
    // entre si porque el igv se deriva de los ya redondeados.
    expect(r.subtotal).toBe(125.42);
    expect(r.igv).toBe(22.57);
    expect(r.subtotal + r.igv).toBe(r.total);
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

  it('precio no exacto: factor 3, precio 10 → 3.333333 (6 decimales)', () => {
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
    expect(r.precioUnitario).toBe(3.333333);
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

describe('CompraService.calcularDetalle — override de factor (empaque variable)', () => {
  it('override 40 sobre config 50: 2 Saco × S/8 → 80 u × S/0.20', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Maíz',
        productoId: 'maiz',
        usaUnidadCompra: true,
        cantidad: 2,
        precioUnitario: 8,
        factorCompra: 40, // el saco vino con 40, no las 50 configuradas
      },
      0,
      mapDe({ maiz: { factor: 50, simbolo: 'Saco' } }),
      true,
    );
    expect(r.cantidad).toBe(80); // 2 × 40
    expect(r.precioUnitario).toBe(0.2); // 8 / 40
    expect(r.factorAplicado).toBe(40); // snapshot del override (no la config)
    expect(r.cantidadOriginal).toBe(2);
    expect(r.unidadOriginalSimbolo).toBe('Saco');
    expect(r.total).toBe(16); // 80 × 0.20
  });

  it('sin override usa el factor de la config (50)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Maíz',
        productoId: 'maiz',
        usaUnidadCompra: true,
        cantidad: 2,
        precioUnitario: 10,
      },
      0,
      mapDe({ maiz: { factor: 50, simbolo: 'Saco' } }),
      true,
    );
    expect(r.cantidad).toBe(100); // 2 × 50
    expect(r.precioUnitario).toBe(0.2); // 10 / 50
    expect(r.factorAplicado).toBe(50);
  });

  it('override 0 / inválido → cae al factor de config', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Maíz',
        productoId: 'maiz',
        usaUnidadCompra: true,
        cantidad: 1,
        precioUnitario: 10,
        factorCompra: 0,
      },
      0,
      mapDe({ maiz: { factor: 50, simbolo: 'Saco' } }),
      true,
    );
    expect(r.factorAplicado).toBe(50);
    expect(r.cantidad).toBe(50);
  });

  it('override se ignora si la línea está en unidad base (sin usaUnidadCompra)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Maíz',
        productoId: 'maiz',
        cantidad: 5,
        precioUnitario: 2,
        factorCompra: 40,
      },
      0,
      mapDe({ maiz: { factor: 50, simbolo: 'Saco' } }),
      true,
    );
    expect(r.usaUnidadCompra).toBe(false);
    expect(r.cantidad).toBe(5); // sin conversión
    expect(r.precioUnitario).toBe(2);
    expect(r.factorAplicado).toBeNull();
  });
});

describe('CompraService.calcularDetalle — variantes', () => {
  it('variante en unidad base: conserva varianteId + productoId, sin conversión', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Polo Talla M',
        productoId: 'polo',
        varianteId: 'polo-m',
        cantidad: 12,
        precioUnitario: 15,
      },
      0,
      undefined,
      true,
    );
    expect(r.varianteId).toBe('polo-m');
    expect(r.productoId).toBe('polo');
    expect(r.usaUnidadCompra).toBe(false);
    expect(r.cantidad).toBe(12);
    expect(r.precioUnitario).toBe(15);
  });

  it('variante por paquete: convierte por el factor del producto y conserva varianteId', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Gaseosa 500ml Cola',
        productoId: 'gaseosa',
        varianteId: 'gaseosa-cola',
        usaUnidadCompra: true,
        cantidad: 3,
        precioUnitario: 24,
      },
      0,
      mapDe({ gaseosa: { factor: 12, simbolo: 'Caja' } }),
      true,
    );
    expect(r.varianteId).toBe('gaseosa-cola');
    expect(r.cantidad).toBe(36); // 3 × 12
    expect(r.precioUnitario).toBe(2); // 24 / 12
    expect(r.factorAplicado).toBe(12);
    expect(r.unidadOriginalSimbolo).toBe('Caja');
  });

  it('variante por paquete con override de empaque (9 en vez de 12)', () => {
    const r = calcularDetalle(
      {
        descripcion: 'Gaseosa 500ml Cola',
        productoId: 'gaseosa',
        varianteId: 'gaseosa-cola',
        usaUnidadCompra: true,
        cantidad: 2,
        precioUnitario: 18,
        factorCompra: 9,
      },
      0,
      mapDe({ gaseosa: { factor: 12, simbolo: 'Caja' } }),
      true,
    );
    expect(r.cantidad).toBe(18); // 2 × 9
    expect(r.precioUnitario).toBe(2); // 18 / 9
    expect(r.factorAplicado).toBe(9);
    expect(r.varianteId).toBe('gaseosa-cola');
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

  it('cuero: 140 cm @ 0.04 + 1000 cm @ 0.05 → 0.048772 (6 dec)', () => {
    // (140×0.04 + 1000×0.05) / 1140 = 0.0487719…
    // A 2 decimales daba 0.05: un 2.5% arriba en cada compra, y el error se
    // acumulaba compra tras compra dentro del promedio ponderado.
    expect(CompraService.calcularNuevoCostoPromedio(140, 0.04, 1000, 0.05)).toBe(
      0.048772,
    );
  });

  it('cuero: 140 cm @ 0.04 + 1 cm @ 0.05 → 0.040071 (apenas mueve)', () => {
    // (140×0.04 + 1×0.05) / 141 = 0.0400709…
    expect(CompraService.calcularNuevoCostoPromedio(140, 0.04, 1, 0.05)).toBe(
      0.040071,
    );
  });

  it('granel: un saco de 22 kg en gramos NO se redondea a S/0.01/g', () => {
    // 147.99 / 22 000 = 0.0067268… A 2 decimales quedaba 0.01/g = S/10/kg,
    // un 48% arriba del costo real (S/6.73/kg).
    const costo = CompraService.calcularNuevoCostoPromedio(
      0,
      0,
      22000,
      147.99 / 22000,
    );
    expect(costo).toBe(0.006727);
    // El equivalente por kilo vuelve a ser el real.
    expect(+(costo * 1000).toFixed(2)).toBe(6.73);
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

// ─────────────────────────────────────────────────────────────────────────────
// Gastos de compra (flete / movilidad) y su prorrateo al costo
// ─────────────────────────────────────────────────────────────────────────────

const calcularGasto = (dto: any, index = 0) =>
  (CompraService as any).calcularGasto(dto, index);

const linea = (id: string, total: number, cantidad: number, conProducto = true) => ({
  id,
  cantidad,
  total,
  productoId: conProducto ? 'p-' + id : null,
  varianteId: null,
});

describe('CompraService.calcularGasto', () => {
  it('sin IGV (recibo de movilidad): la base es el monto entero', () => {
    const g = calcularGasto({ concepto: 'Movilidad Lima-Trujillo', monto: 30 });
    expect(g.base).toBe(30);
    expect(g.igv).toBe(0);
    expect(g.prorratea).toBe(true); // el default es que sí sube el costo
    expect(g.criterio).toBe('VALOR');
  });

  it('gravado dentro de la factura: EXTRAE el IGV, igual que una línea', () => {
    const g = calcularGasto({ concepto: 'Flete', monto: 118, porcentajeIGV: 18 });
    expect(g.base).toBe(100);
    expect(g.igv).toBe(18);
    expect(g.base + g.igv).toBe(g.monto); // el desglose cierra
  });

  it('respeta prorratea=false (interés por pago diferido)', () => {
    const g = calcularGasto({ concepto: 'Interés 30 días', monto: 15, prorratea: false });
    expect(g.prorratea).toBe(false);
  });
});

describe('CompraService.prorratearGastos', () => {
  it('reparte POR VALOR: el ítem caro absorbe más flete', () => {
    // 10 edredones a S/60 = 600 · 20 cojines a S/15 = 300 · movilidad 30 + 20
    const reparto = CompraService.prorratearGastos(
      [linea('edredones', 600, 10), linea('cojines', 300, 20)],
      [
        { monto: 30, prorratea: true, criterio: 'VALOR' as any },
        { monto: 20, prorratea: true, criterio: 'VALOR' as any },
      ],
    );
    expect(reparto.get('edredones')).toBeCloseTo(33.33, 2);
    expect(reparto.get('cojines')).toBeCloseTo(16.67, 2);
    // Y el costo unitario queda como se le explicó al user
    expect((600 + reparto.get('edredones')!) / 10).toBeCloseTo(63.333, 3);
    expect((300 + reparto.get('cojines')!) / 20).toBeCloseTo(15.8335, 4);
  });

  it('🔴 cierra EXACTO aunque el reparto no sea divisible', () => {
    // 3 líneas iguales y S/10: 3.33 + 3.33 + 3.34
    const reparto = CompraService.prorratearGastos(
      [linea('a', 100, 1), linea('b', 100, 1), linea('c', 100, 1)],
      [{ monto: 10, prorratea: true, criterio: 'VALOR' as any }],
    );
    const suma = [...reparto.values()].reduce((s, v) => s + v, 0);
    expect(Number(suma.toFixed(2))).toBe(10);
  });

  it('ignora los gastos con prorratea=false', () => {
    const reparto = CompraService.prorratearGastos(
      [linea('a', 100, 1)],
      [
        { monto: 30, prorratea: true, criterio: 'VALOR' as any },
        { monto: 15, prorratea: false, criterio: 'VALOR' as any },
      ],
    );
    expect(reparto.get('a')).toBe(30); // el interés NO entró al costo
  });

  it('por CANTIDAD reparte por unidades, no por plata', () => {
    const reparto = CompraService.prorratearGastos(
      [linea('caro', 900, 1), linea('barato', 100, 9)],
      [{ monto: 100, prorratea: true, criterio: 'CANTIDAD' as any }],
    );
    expect(reparto.get('caro')).toBeCloseTo(10, 2);
    expect(reparto.get('barato')).toBeCloseTo(90, 2);
  });

  it('deja afuera las líneas que no mueven stock', () => {
    const reparto = CompraService.prorratearGastos(
      [linea('producto', 100, 1), linea('servicio', 100, 1, false)],
      [{ monto: 20, prorratea: true, criterio: 'VALOR' as any }],
    );
    expect(reparto.get('producto')).toBe(20);
    expect(reparto.has('servicio')).toBe(false);
  });

  it('sin líneas con stock no explota ni reparte', () => {
    const reparto = CompraService.prorratearGastos(
      [linea('servicio', 100, 1, false)],
      [{ monto: 20, prorratea: true, criterio: 'VALOR' as any }],
    );
    expect(reparto.size).toBe(0);
  });

  it('compra en cero: reparte parejo en vez de dividir por cero', () => {
    const reparto = CompraService.prorratearGastos(
      [linea('a', 0, 0), linea('b', 0, 0)],
      [{ monto: 10, prorratea: true, criterio: 'VALOR' as any }],
    );
    expect(reparto.get('a')).toBe(5);
    expect(reparto.get('b')).toBe(5);
  });
});
