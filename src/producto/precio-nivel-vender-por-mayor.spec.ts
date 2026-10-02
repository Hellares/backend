import { PrecioNivelService } from './precio-nivel.service';
import { TipoPrecioNivel } from '@prisma/client';

/**
 * VENDER POR MAYOR — el cajero decide cobrar el precio por mayor aunque la
 * cantidad no llegue al mínimo del nivel (`forzarMayor`).
 *
 * La línea se precia como si llevara el mínimo del escalón pedido. Lo que no
 * puede romperse:
 *
 *  1. Sin `nivelId` se fuerza el PRIMER escalón (el de menor mínimo), no el
 *     más barato: el cajero no eligió regalar el nivel más alto.
 *  2. No es un precio aparte: entra al mismo "gana el menor", así que una
 *     liquidación sigue mandando y quien ya llega por cantidad a un escalón
 *     mejor lo conserva.
 *  3. Un `nivelId` que ya no existe revienta: caer en silencio a otro escalón
 *     cobraría un precio que el cajero no eligió.
 *  4. Un ítem sin escalones queda a su precio de siempre, sin error.
 */

const D = (n: number) => ({
  toNumber: () => n,
  toFixed: (d: number) => n.toFixed(d),
});

const nivel = (opts: {
  id: string;
  precio: number;
  min: number;
  max?: number | null;
  nombre?: string;
}) => ({
  id: opts.id,
  varianteId: 'v-alianza',
  nombre: opts.nombre ?? 'Por Mayor',
  cantidadMinima: opts.min,
  cantidadMaxima: opts.max ?? null,
  tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
  precio: D(opts.precio),
  porcentajeDesc: null,
  isActive: true,
});

describe('PrecioNivelService.calcularPrecioSegunCantidad (vender por mayor)', () => {
  const stockObj = (opts: { precio: number; liq?: number | null }) => ({
    precio: D(opts.precio),
    precioCosto: null,
    precioOferta: null,
    precioLiquidacion: opts.liq != null ? D(opts.liq) : null,
    enOferta: false,
    enLiquidacion: opts.liq != null,
    motivoLiquidacion: opts.liq != null ? 'REMATE' : null,
    fechaInicioOferta: null,
    fechaFinOferta: null,
    fechaInicioLiquidacion: null,
    fechaFinLiquidacion: null,
  });

  // Como los devuelve la consulta real: `orderBy cantidadMinima desc`.
  const DOS_ESCALONES = [
    nivel({ id: 'n-6', precio: 70, min: 6, nombre: 'Mayorista' }),
    nivel({ id: 'n-3', precio: 72, min: 3 }),
  ];

  /** Una variante a S/75 con `Por Mayor ≥3 → 72` y `Mayorista ≥6 → 70`. */
  function makeCalc(opts: { stock?: any; niveles?: any[] } = {}) {
    const fakeThis: any = {
      logger: { info: jest.fn() },
      prisma: {
        producto: { findUnique: jest.fn() },
        productoVariante: {
          findUnique: jest.fn().mockResolvedValue({
            nombre: '2 PLAZAS / TELA / 3 PZS / HOMBRE / ALIANZA',
            productoId: 'prod-edredones',
            stocksPorSede: [opts.stock ?? stockObj({ precio: 75 })],
          }),
        },
        precioNivel: {
          findMany: jest.fn().mockResolvedValue(opts.niveles ?? DOS_ESCALONES),
        },
      },
    };
    fakeThis._calcularCandidatoVip = (
      PrecioNivelService.prototype as any
    )['_calcularCandidatoVip'].bind(fakeThis);
    return (PrecioNivelService.prototype as any)[
      'calcularPrecioSegunCantidad'
    ].bind(fakeThis);
  }

  it('sin forzar, 1 unidad paga lista (comportamiento de siempre)', async () => {
    const r = await makeCalc()('prod-x', 'v-alianza', 'sede-1', 1);
    expect(r.precioUnitario).toBe(75);
    expect(r.nivelForzado).toBe(false);
  });

  it('forzado sin nivelId: 1 unidad paga el PRIMER escalón, marcado "(manual)"', async () => {
    const r = await makeCalc()('prod-x', 'v-alianza', 'sede-1', 1, {
      forzarMayor: {},
    });
    expect(r.precioUnitario).toBe(72);
    expect(r.nivelAplicado).toBe('Por Mayor (manual)');
    expect(r.nivelForzado).toBe(true);
  });

  it('forzado con nivelId: paga el escalón ELEGIDO', async () => {
    const r = await makeCalc()('prod-x', 'v-alianza', 'sede-1', 1, {
      forzarMayor: { nivelId: 'n-6' },
    });
    expect(r.precioUnitario).toBe(70);
    expect(r.nivelAplicado).toBe('Mayorista (manual)');
  });

  it('quien ya llega por cantidad a un escalón mejor lo conserva, sin "(manual)"', async () => {
    const r = await makeCalc()('prod-x', 'v-alianza', 'sede-1', 6, {
      forzarMayor: {},
    });
    expect(r.precioUnitario).toBe(70);
    expect(r.nivelAplicado).toBe('Mayorista');
    expect(r.nivelForzado).toBe(false);
  });

  it('escalones con tope (3–5 y 6+): forzar el de 6 no cae en el de 3–5', async () => {
    const calc = makeCalc({
      niveles: [
        nivel({ id: 'n-6', precio: 70, min: 6 }),
        nivel({ id: 'n-3', precio: 72, min: 3, max: 5 }),
      ],
    });
    const primero = await calc('prod-x', 'v-alianza', 'sede-1', 1, { forzarMayor: {} });
    expect(primero.precioUnitario).toBe(72);
    const elegido = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      forzarMayor: { nivelId: 'n-6' },
    });
    expect(elegido.precioUnitario).toBe(70);
  });

  it('la liquidación sigue mandando: forzar no la pisa', async () => {
    const r = await makeCalc({ stock: stockObj({ precio: 75, liq: 60 }) })(
      'prod-x', 'v-alianza', 'sede-1', 1, { forzarMayor: {} },
    );
    expect(r.precioUnitario).toBe(60);
    expect(r.nivelForzado).toBe(false);
  });

  it('un nivelId que ya no existe revienta, no cae a otro escalón', async () => {
    await expect(
      makeCalc()('prod-x', 'v-alianza', 'sede-1', 1, {
        forzarMayor: { nivelId: 'n-borrado' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'NIVEL_MAYOR_NO_DISPONIBLE' },
    });
  });

  it('sin escalones por mayor queda a su precio, sin error', async () => {
    const r = await makeCalc({
      // Un nivel "desde 1" es el precio de siempre con otro nombre.
      niveles: [nivel({ id: 'n-1', precio: 74, min: 1, nombre: 'Promo' })],
    })('prod-x', 'v-alianza', 'sede-1', 1, { forzarMayor: {} });
    expect(r.precioUnitario).toBe(74);
    expect(r.nivelForzado).toBe(false);
    expect(r.escalonesMayor).toEqual([]);
  });

  it('devuelve los escalones del más bajo al más alto, con su precio', async () => {
    const r = await makeCalc()('prod-x', 'v-alianza', 'sede-1', 1);
    expect(r.escalonesMayor).toEqual([
      { id: 'n-3', nombre: 'Por Mayor', cantidadMinima: 3, precio: 72 },
      { id: 'n-6', nombre: 'Mayorista', cantidadMinima: 6, precio: 70 },
    ]);
  });
});
