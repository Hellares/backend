import { PrecioNivelService } from './precio-nivel.service';
import { TipoPrecioNivel } from '@prisma/client';

/**
 * MAYOREO COMBINADO — el mínimo de un nivel se mide contra las unidades del
 * GRUPO, no de la línea.
 *
 * El caso real que lo motivó (JAYLI FLORES, producto EDREDONES): el cliente se
 * lleva 1 ALIANZA + 1 RONALDO + 1 SNOOPY. Las tres son `2 PLAZAS / TELA /
 * 3 PZS`, las tres valen S/75 y las tres tienen cargado `Por Mayor ≥ 3 → S/72`.
 * Son tres edredones, así que corresponde precio por mayor; el sistema veía
 * tres líneas de una unidad y cobraba S/225 en vez de S/216.
 *
 * Dos variantes caen en el mismo grupo cuando tienen un nivel EQUIVALENTE
 * (mismo producto, mínimo, máximo, tipo y valor). El nombre del nivel no entra
 * en la llave.
 *
 * Igual que en precio-nivel-vip.spec.ts, los métodos no son puros (usan
 * this.prisma / this.logger), así que se invocan sobre el prototype con un
 * `this` falso.
 */

// Helper: simula un Prisma.Decimal con .toFixed()/.toNumber().
const D = (n: number) => ({
  toNumber: () => n,
  toFixed: (d: number) => n.toFixed(d),
});

/** Nivel PRECIO_FIJO con los defaults del caso JAYLI (`Por Mayor ≥ 3`). */
const nivel = (opts: {
  varianteId: string;
  precio: number;
  min?: number;
  max?: number | null;
  nombre?: string;
}) => ({
  varianteId: opts.varianteId,
  nombre: opts.nombre ?? 'Por Mayor',
  cantidadMinima: opts.min ?? 3,
  cantidadMaxima: opts.max ?? null,
  tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
  precio: D(opts.precio),
  porcentajeDesc: null,
  isActive: true,
});

describe('PrecioNivelService.calcularCantidadesGrupoMayoreo', () => {
  function call(
    items: Array<{
      varianteId?: string | null;
      cantidad: number;
      ignorarNiveles?: boolean;
    }>,
    datos: {
      variantes?: Array<{ id: string; productoId: string }>;
      niveles?: any[];
    } = {},
  ): Promise<Map<string, number>> {
    const fakeThis: any = {
      prisma: {
        productoVariante: {
          findMany: jest.fn().mockResolvedValue(datos.variantes ?? []),
        },
        precioNivel: {
          findMany: jest.fn().mockResolvedValue(datos.niveles ?? []),
        },
      },
    };
    return (PrecioNivelService.prototype as any)[
      'calcularCantidadesGrupoMayoreo'
    ].call(fakeThis, items);
  }

  // Las tres variantes reales del caso, todas del mismo producto y con el
  // mismo `Por Mayor ≥ 3 → S/72`.
  const EDREDONES = 'prod-edredones';
  const TRES_VARIANTES = [
    { id: 'v-alianza', productoId: EDREDONES },
    { id: 'v-ronaldo', productoId: EDREDONES },
    { id: 'v-snoopy', productoId: EDREDONES },
  ];
  const TRES_NIVELES = [
    nivel({ varianteId: 'v-alianza', precio: 72 }),
    nivel({ varianteId: 'v-ronaldo', precio: 72 }),
    nivel({ varianteId: 'v-snoopy', precio: 72 }),
  ];

  it('el caso JAYLI: 1 + 1 + 1 de tres diseños suman 3 en el grupo', async () => {
    const totales = await call(
      [
        { varianteId: 'v-alianza', cantidad: 1 },
        { varianteId: 'v-ronaldo', cantidad: 1 },
        { varianteId: 'v-snoopy', cantidad: 1 },
      ],
      { variantes: TRES_VARIANTES, niveles: TRES_NIVELES },
    );
    expect([...totales.values()]).toEqual([3]);
    expect(totales.get(`${EDREDONES}|3|inf|PRECIO_FIJO|72.000000`)).toBe(3);
  });

  it('el mismo precio por mayor en DOS PRODUCTOS distintos no suma', async () => {
    const totales = await call(
      [
        { varianteId: 'v-edredon', cantidad: 2 },
        { varianteId: 'v-almohada', cantidad: 2 },
      ],
      {
        variantes: [
          { id: 'v-edredon', productoId: 'prod-edredones' },
          { id: 'v-almohada', productoId: 'prod-almohadas' },
        ],
        niveles: [
          nivel({ varianteId: 'v-edredon', precio: 72 }),
          nivel({ varianteId: 'v-almohada', precio: 72 }),
        ],
      },
    );
    // Dos grupos de 2, no uno de 4: el mayoreo se acumula DENTRO del producto.
    expect([...totales.values()].sort()).toEqual([2, 2]);
  });

  it('mismo precio de venta pero distinto precio por mayor → grupos distintos', async () => {
    // Real en prod: S/83 aparece dos veces, una baja a 76 y la otra a 79.
    const totales = await call(
      [
        { varianteId: 'v-py-tela-5', cantidad: 2 },
        { varianteId: 'v-2p-carnerito-3', cantidad: 2 },
      ],
      {
        variantes: [
          { id: 'v-py-tela-5', productoId: EDREDONES },
          { id: 'v-2p-carnerito-3', productoId: EDREDONES },
        ],
        niveles: [
          nivel({ varianteId: 'v-py-tela-5', precio: 76 }),
          nivel({ varianteId: 'v-2p-carnerito-3', precio: 79 }),
        ],
      },
    );
    expect(totales.get(`${EDREDONES}|3|inf|PRECIO_FIJO|76.000000`)).toBe(2);
    expect(totales.get(`${EDREDONES}|3|inf|PRECIO_FIJO|79.000000`)).toBe(2);
  });

  it('el nombre del nivel NO separa grupos: "Por Mayor" y "Mayorista" suman', async () => {
    const totales = await call(
      [
        { varianteId: 'v-a', cantidad: 1 },
        { varianteId: 'v-b', cantidad: 2 },
      ],
      {
        variantes: [
          { id: 'v-a', productoId: EDREDONES },
          { id: 'v-b', productoId: EDREDONES },
        ],
        niveles: [
          nivel({ varianteId: 'v-a', precio: 72, nombre: 'Por Mayor' }),
          nivel({ varianteId: 'v-b', precio: 72, nombre: 'Mayorista' }),
        ],
      },
    );
    expect([...totales.values()]).toEqual([3]);
  });

  it('los componentes de un combo no empujan el mayoreo del resto', async () => {
    const totales = await call(
      [
        { varianteId: 'v-alianza', cantidad: 1 },
        { varianteId: 'v-ronaldo', cantidad: 1 },
        { varianteId: 'v-snoopy', cantidad: 1, ignorarNiveles: true },
      ],
      { variantes: TRES_VARIANTES, niveles: TRES_NIVELES },
    );
    expect([...totales.values()]).toEqual([2]);
  });

  it('una variante con dos niveles entra en los dos grupos', async () => {
    // Real en beta (VAR-000215): "Por Mayor ≥2 → 60" y "Por Mayor ≥3 → 60".
    const totales = await call(
      [
        { varianteId: 'v-doble', cantidad: 1 },
        { varianteId: 'v-otra', cantidad: 2 },
      ],
      {
        variantes: [
          { id: 'v-doble', productoId: EDREDONES },
          { id: 'v-otra', productoId: EDREDONES },
        ],
        niveles: [
          nivel({ varianteId: 'v-doble', precio: 60, min: 2 }),
          nivel({ varianteId: 'v-doble', precio: 60, min: 3 }),
          nivel({ varianteId: 'v-otra', precio: 60, min: 3 }),
        ],
      },
    );
    expect(totales.get(`${EDREDONES}|2|inf|PRECIO_FIJO|60.000000`)).toBe(1);
    expect(totales.get(`${EDREDONES}|3|inf|PRECIO_FIJO|60.000000`)).toBe(3);
  });

  it('la MISMA variante en dos líneas también suma', async () => {
    // El cajero cargó el mismo diseño dos veces en vez de poner cantidad 2.
    const totales = await call(
      [
        { varianteId: 'v-alianza', cantidad: 1 },
        { varianteId: 'v-alianza', cantidad: 2 },
      ],
      {
        variantes: [{ id: 'v-alianza', productoId: EDREDONES }],
        niveles: [nivel({ varianteId: 'v-alianza', precio: 72 })],
      },
    );
    expect(totales.get(`${EDREDONES}|3|inf|PRECIO_FIJO|72.000000`)).toBe(3);
  });

  it('una sola línea con variante ni siquiera consulta la base', async () => {
    const fakeThis: any = {
      prisma: {
        productoVariante: { findMany: jest.fn() },
        precioNivel: { findMany: jest.fn() },
      },
    };
    const totales = await (PrecioNivelService.prototype as any)[
      'calcularCantidadesGrupoMayoreo'
    ].call(fakeThis, [{ varianteId: 'v-sola', cantidad: 5 }]);
    expect(totales.size).toBe(0);
    expect(fakeThis.prisma.productoVariante.findMany).not.toHaveBeenCalled();
    expect(fakeThis.prisma.precioNivel.findMany).not.toHaveBeenCalled();
  });

  it('las líneas sin variante se ignoran (servicios, combos contenedores)', async () => {
    const totales = await call([
      { varianteId: null, cantidad: 4 },
      { cantidad: 9 },
    ]);
    expect(totales.size).toBe(0);
  });

  it('una variante sin nivel cargado no arma grupo', async () => {
    // Las tres huérfanas de prod (FROZEN, MINIE, KITTY) no tienen PrecioNivel.
    const totales = await call(
      [
        { varianteId: 'v-alianza', cantidad: 1 },
        { varianteId: 'v-frozen', cantidad: 1 },
      ],
      {
        variantes: [
          { id: 'v-alianza', productoId: EDREDONES },
          { id: 'v-frozen', productoId: EDREDONES },
        ],
        niveles: [nivel({ varianteId: 'v-alianza', precio: 72 })],
      },
    );
    expect([...totales.values()]).toEqual([1]);
  });
});

describe('PrecioNivelService.obtenerGruposMayoreo (el monitor)', () => {
  const EDREDONES = 'prod-edredones';

  function call(
    variantes: any[],
    opts: { sedeId?: string; producto?: any } = {},
  ) {
    const fakeThis: any = {
      prisma: {
        producto: {
          findUnique: jest.fn().mockResolvedValue(
            // `in` y no `??`: el test del 404 pasa `producto: null` a propósito.
            'producto' in opts
              ? opts.producto
              : { id: EDREDONES, nombre: 'EDREDONES' },
          ),
        },
        productoVariante: { findMany: jest.fn().mockResolvedValue(variantes) },
      },
    };
    return (PrecioNivelService.prototype as any)['obtenerGruposMayoreo'].call(
      fakeThis,
      EDREDONES,
      opts.sedeId ?? 'sede-1',
    );
  }

  const variante = (opts: {
    id: string;
    nombre: string;
    sku: string;
    precioVenta?: number | null;
    stock?: number;
    niveles?: any[];
  }) => ({
    id: opts.id,
    nombre: opts.nombre,
    sku: opts.sku,
    isActive: true,
    preciosNivel: opts.niveles ?? [],
    stocksPorSede:
      opts.precioVenta === undefined
        ? []
        : [
            {
              precio: opts.precioVenta == null ? null : D(opts.precioVenta),
              stockActual: opts.stock ?? 0,
            },
          ],
  });

  it('junta en un grupo las variantes con el mismo nivel', async () => {
    const r = await call([
      variante({
        id: 'v-alianza',
        nombre: 'ALIANZA',
        sku: 'VAR-000002',
        precioVenta: 75,
        stock: 6,
        niveles: [nivel({ varianteId: 'v-alianza', precio: 72 })],
      }),
      variante({
        id: 'v-ronaldo',
        nombre: 'RONALDO',
        sku: 'VAR-000007',
        precioVenta: 75,
        stock: 2,
        niveles: [nivel({ varianteId: 'v-ronaldo', precio: 72 })],
      }),
    ]);

    expect(r.totalVariantes).toBe(2);
    expect(r.variantesEnGrupo).toBe(2);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].nombreNivel).toBe('Por Mayor');
    expect(r.grupos[0].cantidadMinima).toBe(3);
    expect(r.grupos[0].precio).toBe(72);
    expect(r.grupos[0].variantes.map((v: any) => v.sku)).toEqual([
      'VAR-000002',
      'VAR-000007',
    ]);
    expect(r.grupos[0].variantes[0].ahorroUnitario).toBe(3);
    expect(r.grupos[0].preciosVentaDispares).toBe(false);
    expect(r.sinNivel).toHaveLength(0);
  });

  it('separa por precio: mismo venta, distinto mayor → dos grupos', async () => {
    const r = await call([
      variante({
        id: 'v-a',
        nombre: 'A',
        sku: 'A',
        precioVenta: 83,
        niveles: [nivel({ varianteId: 'v-a', precio: 76 })],
      }),
      variante({
        id: 'v-b',
        nombre: 'B',
        sku: 'B',
        precioVenta: 83,
        niveles: [nivel({ varianteId: 'v-b', precio: 79 })],
      }),
    ]);
    expect(r.grupos).toHaveLength(2);
  });

  it('las variantes sin nivel salen aparte: nunca harán mayoreo', async () => {
    const r = await call([
      variante({
        id: 'v-alianza',
        nombre: 'ALIANZA',
        sku: 'VAR-000002',
        precioVenta: 75,
        niveles: [nivel({ varianteId: 'v-alianza', precio: 72 })],
      }),
      variante({
        id: 'v-frozen',
        nombre: 'FROZEN',
        sku: 'VAR-000044',
        precioVenta: 60,
      }),
    ]);

    expect(r.variantesEnGrupo).toBe(1);
    expect(r.sinNivel).toHaveLength(1);
    expect(r.sinNivel[0].sku).toBe('VAR-000044');
  });

  it('marca el grupo cuyas variantes NO comparten precio de lista', async () => {
    // Mismo mayor S/72 pero una vende a 75 y la otra a 80: la rebaja es la
    // misma pero el descuento no, y casi siempre es un precio mal cargado.
    const r = await call([
      variante({
        id: 'v-a',
        nombre: 'A',
        sku: 'A',
        precioVenta: 75,
        niveles: [nivel({ varianteId: 'v-a', precio: 72 })],
      }),
      variante({
        id: 'v-b',
        nombre: 'B',
        sku: 'B',
        precioVenta: 80,
        niveles: [nivel({ varianteId: 'v-b', precio: 72 })],
      }),
    ]);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].preciosVentaDispares).toBe(true);
  });

  it('marca el nivel que nunca va a aplicar porque no baja el precio', async () => {
    const r = await call([
      variante({
        id: 'v-a',
        nombre: 'A',
        sku: 'A',
        precioVenta: 70,
        niveles: [nivel({ varianteId: 'v-a', precio: 72 })],
      }),
      variante({
        id: 'v-b',
        nombre: 'B',
        sku: 'B',
        precioVenta: 70,
        niveles: [nivel({ varianteId: 'v-b', precio: 72 })],
      }),
    ]);
    expect(r.grupos[0].nivelSinEfecto).toBe(true);
  });

  it('una variante con dos niveles aparece en los dos grupos', async () => {
    const r = await call([
      variante({
        id: 'v-doble',
        nombre: 'DOBLE',
        sku: 'VAR-000215',
        precioVenta: 80,
        niveles: [
          nivel({ varianteId: 'v-doble', precio: 60, min: 2 }),
          nivel({ varianteId: 'v-doble', precio: 60, min: 3 }),
        ],
      }),
    ]);
    expect(r.grupos).toHaveLength(2);
    expect(r.grupos.map((g: any) => g.cantidadMinima).sort()).toEqual([2, 3]);
    expect(r.variantesEnGrupo).toBe(1);
  });

  it('un nivel PORCENTAJE resuelve el precio contra la lista de CADA variante', async () => {
    const pct = (varianteId: string) => ({
      varianteId,
      nombre: 'Por Mayor',
      cantidadMinima: 3,
      cantidadMaxima: null,
      tipoPrecio: TipoPrecioNivel.PORCENTAJE_DESCUENTO,
      precio: null,
      porcentajeDesc: D(10),
      isActive: true,
    });
    const r = await call([
      variante({
        id: 'v-a',
        nombre: 'A',
        sku: 'A',
        precioVenta: 100,
        niveles: [pct('v-a')],
      }),
      variante({
        id: 'v-b',
        nombre: 'B',
        sku: 'B',
        precioVenta: 50,
        niveles: [pct('v-b')],
      }),
    ]);
    // Un solo grupo (el descuento es el mismo), dos precios distintos.
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].variantes.map((v: any) => v.precioConNivel)).toEqual([
      90, 45,
    ]);
  });

  it('los grupos más grandes van primero', async () => {
    const r = await call([
      variante({
        id: 'v-a',
        nombre: 'A',
        sku: 'A',
        precioVenta: 75,
        niveles: [nivel({ varianteId: 'v-a', precio: 72 })],
      }),
      variante({
        id: 'v-b',
        nombre: 'B',
        sku: 'B',
        precioVenta: 75,
        niveles: [nivel({ varianteId: 'v-b', precio: 72 })],
      }),
      variante({
        id: 'v-c',
        nombre: 'C',
        sku: 'C',
        precioVenta: 83,
        niveles: [nivel({ varianteId: 'v-c', precio: 79 })],
      }),
    ]);
    expect(r.grupos.map((g: any) => g.variantes.length)).toEqual([2, 1]);
  });

  it('producto inexistente → 404', async () => {
    await expect(call([], { producto: null })).rejects.toThrow(
      'Producto prod-edredones no encontrado',
    );
  });
});

describe('PrecioNivelService.calcularPrecioSegunCantidad (mayoreo combinado)', () => {
  const EDREDONES = 'prod-edredones';
  const CLAVE_72 = `${EDREDONES}|3|inf|PRECIO_FIJO|72.000000`;

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

  /** Arma el cálculo para UNA variante de EDREDONES a S/75 con `Por Mayor ≥3 → 72`. */
  function makeCalc(opts: { stock?: any; niveles?: any[] } = {}) {
    const fakeThis: any = {
      logger: { info: jest.fn() },
      prisma: {
        producto: { findUnique: jest.fn() },
        productoVariante: {
          findUnique: jest.fn().mockResolvedValue({
            nombre: '2 PLAZAS / TELA / 3 PZS / HOMBRE / ALIANZA',
            productoId: EDREDONES,
            stocksPorSede: [opts.stock ?? stockObj({ precio: 75 })],
          }),
        },
        precioNivel: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              opts.niveles ?? [nivel({ varianteId: 'v-alianza', precio: 72 })],
            ),
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

  it('1 unidad con el grupo en 3 → cobra por mayor', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([[CLAVE_72, 3]]),
    });
    expect(r.precioUnitario).toBe(72);
    expect(r.nivelAplicado).toBe('Por Mayor');
  });

  it('1 unidad SIN mapa de grupo → precio de lista (comportamiento de siempre)', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1);
    expect(r.precioUnitario).toBe(75);
    expect(r.nivelAplicado).toBe('Precio base');
  });

  it('el grupo llega a 2 y el mínimo es 3 → no baja', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([[CLAVE_72, 2]]),
    });
    expect(r.precioUnitario).toBe(75);
  });

  it('la línea que sola ya supera el mínimo no depende del grupo', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 4, {
      cantidadesGrupo: new Map([[CLAVE_72, 1]]),
    });
    expect(r.precioUnitario).toBe(72);
  });

  it('un grupo de otro precio no habilita este nivel', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([
        [`${EDREDONES}|3|inf|PRECIO_FIJO|76.000000`, 12],
      ]),
    });
    expect(r.precioUnitario).toBe(75);
  });

  it('la liquidación sigue ganando sobre el mayoreo combinado', async () => {
    const calc = makeCalc({ stock: stockObj({ precio: 75, liq: 40 }) });
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([[CLAVE_72, 3]]),
    });
    expect(r.precioUnitario).toBe(40);
    expect(r.nivelAplicado).toBe('Liquidación');
  });

  it('un componente de combo (ignorarNiveles) no toma el precio del grupo', async () => {
    const calc = makeCalc();
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      ignorarNiveles: true,
      cantidadesGrupo: new Map([[CLAVE_72, 3]]),
    });
    expect(r.precioUnitario).toBe(75);
  });

  it('cantidadMaxima también se mide contra el grupo', async () => {
    // Nivel con tope: "de 3 a 5 unidades". El grupo suma 9 → se pasó del tope.
    const calc = makeCalc({
      niveles: [nivel({ varianteId: 'v-alianza', precio: 72, max: 5 })],
    });
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([
        [`${EDREDONES}|3|5|PRECIO_FIJO|72.000000`, 9],
      ]),
    });
    expect(r.precioUnitario).toBe(75);
  });

  it('con dos escalones aplicables gana el de mínimo más alto', async () => {
    const calc = makeCalc({
      niveles: [
        nivel({ varianteId: 'v-alianza', precio: 68, min: 6 }),
        nivel({ varianteId: 'v-alianza', precio: 72, min: 3 }),
      ],
    });
    const r = await calc('prod-x', 'v-alianza', 'sede-1', 1, {
      cantidadesGrupo: new Map([
        [`${EDREDONES}|6|inf|PRECIO_FIJO|68.000000`, 6],
        [`${EDREDONES}|3|inf|PRECIO_FIJO|72.000000`, 6],
      ]),
    });
    expect(r.precioUnitario).toBe(68);
  });
});
