import { BadRequestException, ConflictException } from '@nestjs/common';
import { VariantePlantillaService } from './variante-plantilla.service';

/**
 * Plantillas de variantes. Prisma mockeado: se verifica la ORQUESTACIÓN —qué
 * combinaciones salen de una colección, qué variantes nacen al aplicar y con
 * qué nombre, valores y precios—. La prueba contra una base real va en beta.
 */
const ATR = {
  tam: { id: 'a-tam', clave: 'tamano', nombre: 'Tamaño', orden: 1, usarEnNombreVariante: true, tipo: 'SELECT', valores: ['2 PLAZAS'] },
  mat: { id: 'a-mat', clave: 'material', nombre: 'Material', orden: 2, usarEnNombreVariante: true, tipo: 'SELECT', valores: ['TELA', 'CARNERITO'] },
  col: { id: 'a-col', clave: 'dise_o', nombre: 'Colección', orden: 5, usarEnNombreVariante: true, tipo: 'SELECT', valores: ['CRISTAL', 'KITTY'] },
  dis: { id: 'a-dis', clave: 'diseno', nombre: 'Diseño', orden: 9, usarEnNombreVariante: true, tipo: 'TEXTO', valores: [] },
};

const av = (a: { id: string; clave: string; orden: number }, valor: string) => ({
  atributoId: a.id,
  valor,
  atributo: { id: a.id, clave: a.clave, orden: a.orden },
});

function variante(id: string, material: string, coleccion: string, precio: number, diseno?: string) {
  return {
    id,
    atributosValores: [
      av(ATR.tam, '2 PLAZAS'),
      av(ATR.mat, material),
      av(ATR.col, coleccion),
      ...(diseno ? [av(ATR.dis, diseno)] : []),
    ],
    preciosNivel: [{ nombre: 'Por Mayor', cantidadMinima: 3, cantidadMaxima: null, tipoPrecio: 'PRECIO_FIJO', precio: 72, porcentajeDesc: null }],
    stocksPorSede: [{ precioConfigurado: true, precio, precioCosto: 60 }],
  };
}

function montar(opts: { variantes?: unknown[]; existentes?: unknown[]; plantilla?: unknown; otraConNombre?: boolean } = {}) {
  let nVar = 0;
  const tx = {
    productoVariante: { create: jest.fn().mockImplementation(() => Promise.resolve({ id: `v-${++nVar}` })) },
    productoAtributoValor: { createMany: jest.fn().mockResolvedValue({}) },
    precioNivel: { createMany: jest.fn().mockResolvedValue({}) },
    productoStock: { createMany: jest.fn().mockResolvedValue({}) },
    productoAtributo: { update: jest.fn().mockResolvedValue({}) },
  };
  const creada: { data?: any } = {};
  const prisma: any = {
    productoVariante: {
      findMany: jest.fn().mockImplementation((args: any) =>
        // desdeColeccion pide con include; aplicar pide solo atributosValores.
        Promise.resolve(args?.include ? (opts.variantes ?? []) : (opts.existentes ?? [])),
      ),
    },
    productoAtributo: {
      count: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(new Set(where.id.in).size)),
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(Object.values(ATR).filter((a) => where.id.in.includes(a.id))),
      ),
    },
    variantePlantilla: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.nombre) return Promise.resolve(opts.otraConNombre ? { id: 'otra' } : null);
        return Promise.resolve(opts.plantilla ?? { id: 'pl-1', ...creada.data, combinaciones: creada.data?.combinaciones?.create ?? [] });
      }),
      create: jest.fn().mockImplementation((args: any) => {
        creada.data = args.data;
        return Promise.resolve({ id: 'pl-1' });
      }),
    },
    producto: {
      findFirst: jest.fn().mockResolvedValue({ id: 'p1', tieneVariantes: true, isActive: true, sedeId: null }),
    },
    productoStock: { findMany: jest.fn().mockResolvedValue([{ sedeId: 's1' }]) },
    sede: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new VariantePlantillaService(
    prisma,
    { invalidateProductosLists: jest.fn() } as any,
    { notifyProductoActualizado: jest.fn() } as any,
    { generarCodigoVariante: jest.fn().mockResolvedValue({ codigoEmpresa: 'VAR-900' }) } as any,
    { recalcularProducto: jest.fn() } as any,
  );
  return { service, prisma, tx, creada };
}

describe('VariantePlantillaService.desdeColeccion', () => {
  it('copia la estructura de CRISTAL: sin colección ni diseño, una por combinación', async () => {
    const { service, creada } = montar({
      // De la más nueva a la más vieja: D4 (S/ 95) gana el precio de TELA.
      variantes: [
        variante('d4', 'TELA', 'CRISTAL', 95, 'D4'),
        variante('d1', 'TELA', 'CRISTAL', 75, 'D1'),
        variante('carn', 'CARNERITO', 'CRISTAL', 80),
        variante('kitty', 'TELA', 'KITTY', 70),
      ],
    });

    await service.desdeColeccion('e1', {
      nombre: 'Edredones',
      productoId: 'p1',
      atributoColeccionId: ATR.col.id,
      valorColeccion: 'cristal',
    });

    expect(creada.data.atributoColeccionId).toBe(ATR.col.id);
    expect(creada.data.atributoIds).toEqual([ATR.tam.id, ATR.mat.id]);
    const combos = creada.data.combinaciones.create;
    expect(combos.map((c: any) => c.valores.map((v: any) => v.valor).join(' · '))).toEqual([
      '2 PLAZAS · TELA',
      '2 PLAZAS · CARNERITO',
    ]);
    expect(combos[0]).toMatchObject({ precio: 95, precioCosto: 60 });
    expect(combos[0].niveles[0]).toMatchObject({ nombre: 'Por Mayor', cantidadMinima: 3, precio: 72 });
  });

  it('🔴 una colección que no existe se rechaza', async () => {
    const { service } = montar({ variantes: [variante('kitty', 'TELA', 'KITTY', 70)] });
    await expect(
      service.desdeColeccion('e1', { nombre: 'X', productoId: 'p1', atributoColeccionId: ATR.col.id, valorColeccion: 'CRISTAL' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('VariantePlantillaService.aplicar', () => {
  const plantilla = {
    id: 'pl-1',
    atributoColeccionId: ATR.col.id,
    atributoIds: [ATR.tam.id, ATR.mat.id],
    combinaciones: [
      { id: 'c1', valores: [{ atributoId: ATR.tam.id, valor: '2 PLAZAS' }, { atributoId: ATR.mat.id, valor: 'TELA' }], precio: 75, precioCosto: 60, niveles: [{ nombre: 'Por Mayor', cantidadMinima: 3, tipoPrecio: 'PRECIO_FIJO', precio: 72 }] },
      { id: 'c2', valores: [{ atributoId: ATR.tam.id, valor: '2 PLAZAS' }, { atributoId: ATR.mat.id, valor: 'CARNERITO' }], precio: 80, precioCosto: null, niveles: null },
    ],
  };

  it('crea DINOSAURIO con su nombre, precios, en 0, y suma el valor a la lista', async () => {
    const { service, tx } = montar({ plantilla });

    const r = await service.aplicar('e1', 'pl-1', { productoId: 'p1', valorColeccion: 'DINOSAURIO' });

    expect(r.creadas.map((c) => c.nombre)).toEqual(['2 PLAZAS / TELA / DINOSAURIO', '2 PLAZAS / CARNERITO / DINOSAURIO']);
    expect(r.omitidas).toEqual([]);
    expect(tx.productoAtributoValor.createMany.mock.calls[0][0].data).toEqual([
      { varianteId: 'v-1', atributoId: ATR.tam.id, valor: '2 PLAZAS' },
      { varianteId: 'v-1', atributoId: ATR.mat.id, valor: 'TELA' },
      { varianteId: 'v-1', atributoId: ATR.col.id, valor: 'DINOSAURIO' },
    ]);
    expect(tx.productoStock.createMany.mock.calls[0][0].data[0]).toMatchObject({
      sedeId: 's1',
      stockActual: 0,
      precio: 75,
      precioCosto: 60,
      precioConfigurado: true,
    });
    expect(tx.precioNivel.createMany).toHaveBeenCalledTimes(1);
    // DINOSAURIO entra a la lista de la Colección (SELECT con opciones).
    expect(tx.productoAtributo.update).toHaveBeenCalledWith({
      where: { id: ATR.col.id },
      data: { valores: ['CRISTAL', 'KITTY', 'DINOSAURIO'] },
    });
  });

  it('solo las elegidas, con el precio que se ajustó', async () => {
    const { service, tx } = montar({ plantilla });

    const r = await service.aplicar('e1', 'pl-1', {
      productoId: 'p1',
      valorColeccion: 'DINOSAURIO',
      combinaciones: [{ combinacionId: 'c2', precio: 85 }],
    });

    expect(r.creadas).toHaveLength(1);
    expect(tx.productoStock.createMany.mock.calls[0][0].data[0]).toMatchObject({ precio: 85, precioCosto: null });
  });

  it('🔴 lo que ya existe en el producto se omite y se informa', async () => {
    const { service } = montar({
      plantilla,
      existentes: [
        { atributosValores: [{ atributoId: ATR.tam.id, valor: '2 PLAZAS' }, { atributoId: ATR.mat.id, valor: 'tela' }, { atributoId: ATR.col.id, valor: 'dinosaurio' }] },
      ],
    });

    const r = await service.aplicar('e1', 'pl-1', { productoId: 'p1', valorColeccion: 'DINOSAURIO' });

    expect(r.omitidas).toEqual(['2 PLAZAS / TELA / DINOSAURIO']);
    expect(r.creadas.map((c) => c.nombre)).toEqual(['2 PLAZAS / CARNERITO / DINOSAURIO']);
  });
});

describe('VariantePlantillaService.crear', () => {
  const base = {
    nombre: 'Peluches',
    atributoColeccionId: ATR.col.id,
    atributoIds: [ATR.tam.id],
    combinaciones: [{ valores: [{ atributoId: ATR.tam.id, valor: '2 PLAZAS' }] }],
  };

  it('🔴 el atributo de colección no puede ir entre los de las combinaciones', async () => {
    const { service } = montar();
    await expect(service.crear('e1', { ...base, atributoIds: [ATR.col.id] })).rejects.toThrow(BadRequestException);
  });

  it('🔴 combinaciones repetidas se rechazan', async () => {
    const { service } = montar();
    await expect(
      service.crear('e1', { ...base, combinaciones: [base.combinaciones[0], base.combinaciones[0]] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('🔴 el nombre es único por empresa', async () => {
    const { service } = montar({ otraConNombre: true });
    await expect(service.crear('e1', base)).rejects.toThrow(ConflictException);
  });
});
