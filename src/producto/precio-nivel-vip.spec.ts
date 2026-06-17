import { PrecioNivelService } from './precio-nivel.service';
import { TipoPrecioNivel } from '@prisma/client';

/**
 * Tests de la lógica de PRECIO ESPECIAL VIP del PrecioNivelService (feature
 * "Cliente VIP con precio especial"). Cubre:
 *
 * 1. `_calcularCandidatoVip` — la fórmula de precio por modo (debe ser ESPEJO
 *    EXACTO del cálculo en Flutter, si no el guard 409 PRECIO_DESACTUALIZADO
 *    rebota la venta):
 *      - PRECIO_COSTO (costo × (1 + markup/100))
 *      - PRECIO_MAYOR_DESDE_UNIDAD (primer escalón / mejor nivel, desde la unidad 1)
 *      - PORCENTAJE / MONTO_FIJO (con tope descuentoMaximo)
 *
 * 2. `calcularPrecioSegunCantidad` — que el candidato VIP entre al reduce
 *    "gana el menor" junto con base/oferta/liquidación.
 *
 * Los métodos no son puros (usan this.prisma / this.logger), así que se invocan
 * sobre el prototype con un `this` falso mockeado (mismo patrón que
 * producto-combo-pricing.spec.ts).
 */

// Helper: simula un Prisma.Decimal con .toNumber().
const D = (n: number) => ({ toNumber: () => n });

describe('PrecioNivelService._calcularCandidatoVip', () => {
  function call(
    vip: any,
    opts: { base?: number; costo?: number | null; niveles?: any[] } = {},
  ): Promise<number | null> {
    const fakeThis = {
      prisma: {
        precioNivel: {
          findMany: jest.fn().mockResolvedValue(opts.niveles ?? []),
        },
      },
    };
    const fn = (PrecioNivelService.prototype as any)['_calcularCandidatoVip'].bind(
      fakeThis,
    );
    return fn(vip, 'prod-1', null, opts.base ?? 100, opts.costo ?? null);
  }

  it('PRECIO_COSTO: costo puro (markup 0)', async () => {
    expect(
      await call({ modo: 'PRECIO_COSTO', markupSobreCosto: 0 }, { costo: 27.5 }),
    ).toBe(27.5);
  });

  it('PRECIO_COSTO: costo + markup 5%', async () => {
    expect(
      await call({ modo: 'PRECIO_COSTO', markupSobreCosto: 5 }, { costo: 20 }),
    ).toBe(21); // 20 * 1.05
  });

  it('PRECIO_COSTO: sin costo configurado → null', async () => {
    expect(
      await call({ modo: 'PRECIO_COSTO', markupSobreCosto: 0 }, { costo: null }),
    ).toBeNull();
  });

  it('PRECIO_COSTO: costo 0 → null (no se puede vender al costo)', async () => {
    expect(
      await call({ modo: 'PRECIO_COSTO', markupSobreCosto: 0 }, { costo: 0 }),
    ).toBeNull();
  });

  it('PORCENTAJE: 15% sobre la base', async () => {
    expect(await call({ modo: 'PORCENTAJE', valor: 15 }, { base: 100 })).toBe(85);
  });

  it('PORCENTAJE: capeado por descuentoMaximo', async () => {
    expect(
      await call(
        { modo: 'PORCENTAJE', valor: 50, descuentoMaximo: 10 },
        { base: 100 },
      ),
    ).toBe(90); // descuento 50 → capeado a 10 → 90
  });

  it('MONTO_FIJO: resta el monto', async () => {
    expect(await call({ modo: 'MONTO_FIJO', valor: 20 }, { base: 100 })).toBe(80);
  });

  it('MONTO_FIJO: no baja de 0', async () => {
    expect(await call({ modo: 'MONTO_FIJO', valor: 200 }, { base: 100 })).toBe(0);
  });

  it('MAYOR_DESDE_UNIDAD: PRIMER_NIVEL = menor cantidadMinima > 1', async () => {
    const niveles = [
      {
        cantidadMinima: 3,
        tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
        precio: D(39.9),
        porcentajeDesc: null,
        isActive: true,
      },
      {
        cantidadMinima: 10,
        tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
        precio: D(35),
        porcentajeDesc: null,
        isActive: true,
      },
    ];
    expect(
      await call(
        { modo: 'PRECIO_MAYOR_DESDE_UNIDAD', estrategiaMayor: 'PRIMER_NIVEL' },
        { base: 47, niveles },
      ),
    ).toBe(39.9);
  });

  it('MAYOR_DESDE_UNIDAD: MEJOR_NIVEL = el de menor precio', async () => {
    const niveles = [
      {
        cantidadMinima: 3,
        tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
        precio: D(39.9),
        porcentajeDesc: null,
        isActive: true,
      },
      {
        cantidadMinima: 10,
        tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
        precio: D(35),
        porcentajeDesc: null,
        isActive: true,
      },
    ];
    expect(
      await call(
        { modo: 'PRECIO_MAYOR_DESDE_UNIDAD', estrategiaMayor: 'MEJOR_NIVEL' },
        { base: 47, niveles },
      ),
    ).toBe(35);
  });

  it('MAYOR_DESDE_UNIDAD: nivel PORCENTAJE_DESCUENTO sobre la base', async () => {
    const niveles = [
      {
        cantidadMinima: 3,
        tipoPrecio: TipoPrecioNivel.PORCENTAJE_DESCUENTO,
        precio: null,
        porcentajeDesc: D(20),
        isActive: true,
      },
    ];
    expect(
      await call(
        { modo: 'PRECIO_MAYOR_DESDE_UNIDAD', estrategiaMayor: 'PRIMER_NIVEL' },
        { base: 50, niveles },
      ),
    ).toBe(40); // 50 * (1 - 0.20)
  });

  it('MAYOR_DESDE_UNIDAD: sin niveles → null', async () => {
    expect(
      await call(
        { modo: 'PRECIO_MAYOR_DESDE_UNIDAD', estrategiaMayor: 'PRIMER_NIVEL' },
        { base: 47, niveles: [] },
      ),
    ).toBeNull();
  });
});

describe('PrecioNivelService.calcularPrecioSegunCantidad (reduce con VIP)', () => {
  const stockObj = (opts: {
    precio: number;
    costo?: number | null;
    oferta?: number | null;
    liq?: number | null;
  }) => ({
    precio: D(opts.precio),
    precioCosto: opts.costo != null ? D(opts.costo) : null,
    precioOferta: opts.oferta != null ? D(opts.oferta) : null,
    precioLiquidacion: opts.liq != null ? D(opts.liq) : null,
    enOferta: opts.oferta != null,
    enLiquidacion: opts.liq != null,
    motivoLiquidacion: opts.liq != null ? 'REMATE' : null,
    fechaInicioOferta: null,
    fechaFinOferta: null,
    fechaInicioLiquidacion: null,
    fechaFinLiquidacion: null,
  });

  function makeCalc(stock: any, niveles: any[] = []) {
    const fakeThis: any = {
      logger: { info: jest.fn() },
      prisma: {
        producto: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ nombre: 'P', stocksPorSede: [stock] }),
        },
        productoVariante: { findUnique: jest.fn() },
        precioNivel: { findMany: jest.fn().mockResolvedValue(niveles) },
      },
    };
    // calcularPrecioSegunCantidad llama this._calcularCandidatoVip: lo adjuntamos
    // (el método real, bindeado al mismo this falso para que use su prisma).
    fakeThis._calcularCandidatoVip = (
      PrecioNivelService.prototype as any
    )['_calcularCandidatoVip'].bind(fakeThis);
    return (PrecioNivelService.prototype as any)[
      'calcularPrecioSegunCantidad'
    ].bind(fakeThis);
  }

  const VIP_COSTO = {
    politicaId: 'pol-1',
    etiqueta: 'VIP: Mayoristas',
    modo: 'PRECIO_COSTO',
    markupSobreCosto: 0,
  };

  it('sin VIP → precio base', async () => {
    const calc = makeCalc(stockObj({ precio: 47, costo: 27.5 }));
    const r = await calc('prod-1', null, 'sede-1', 1);
    expect(r.precioUnitario).toBe(47);
    expect(r.vipAplicado).toBe(false);
  });

  it('VIP costo gana cuando es el menor', async () => {
    const calc = makeCalc(stockObj({ precio: 47, costo: 27.5 }));
    const r = await calc('prod-1', null, 'sede-1', 1, { vip: VIP_COSTO });
    expect(r.precioUnitario).toBe(27.5);
    expect(r.vipAplicado).toBe(true);
    expect(r.vipPoliticaId).toBe('pol-1');
    expect(r.nivelAplicado).toBe('VIP: Mayoristas');
  });

  it('liquidación gana sobre VIP costo (gana el menor)', async () => {
    const calc = makeCalc(stockObj({ precio: 47, costo: 27.5, liq: 5 }));
    const r = await calc('prod-1', null, 'sede-1', 1, { vip: VIP_COSTO });
    expect(r.precioUnitario).toBe(5);
    expect(r.vipAplicado).toBe(false);
  });

  it('VIP costo gana sobre oferta más cara', async () => {
    const calc = makeCalc(stockObj({ precio: 47, costo: 27.5, oferta: 40 }));
    const r = await calc('prod-1', null, 'sede-1', 1, { vip: VIP_COSTO });
    expect(r.precioUnitario).toBe(27.5);
    expect(r.vipAplicado).toBe(true);
  });

  it('combo (ignorarNiveles) NO aplica VIP', async () => {
    const calc = makeCalc(stockObj({ precio: 47, costo: 27.5 }));
    const r = await calc('prod-1', null, 'sede-1', 1, {
      vip: VIP_COSTO,
      ignorarNiveles: true,
    });
    expect(r.precioUnitario).toBe(47);
    expect(r.vipAplicado).toBe(false);
  });
});
