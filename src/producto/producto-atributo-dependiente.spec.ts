import { AtributoTipo } from '@prisma/client';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoCatalogService } from './producto-catalog.service';

/**
 * Atributos dependientes (FABRICANTE → FAMILIA → PROCESADOR) y el filtro por
 * valor de atributo.
 *
 * Se mockean las dependencias: nada de infra real.
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const mkCache = () => ({
  invalidateProductosLists: jest.fn().mockResolvedValue(undefined),
});

describe('ProductoAtributoService — cadena de atributos dependientes', () => {
  /**
   * El caso que motivó el apareo por id: si el sincronizador viera el rename
   * como "una opción que sale y otra que entra", borraría la vieja y el
   * cascade del FK se llevaría TODAS sus hijas. Renombrar QUALCOMM se comería
   * sus procesadores sin que nadie lo note.
   */
  it('renombrar por lista plana actualiza la opción EN SU LUGAR, no la borra', async () => {
    const tx = {
      productoAtributo: {
        update: jest.fn().mockResolvedValue({ id: 'a1', dependeDeAtributoId: null }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'a1',
          valores: ['Samsung', 'QUALCOMM'],
          opciones: [],
        }),
      },
      productoAtributoValor: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      productoAtributoOpcion: {
        // Lo que devuelve la base DESPUÉS del rename en su lugar.
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', valor: 'Samsung', padreId: null, orden: 0 },
          { id: 'o2', valor: 'QUALCOMM', padreId: null, orden: 1 },
        ]),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'nuevo' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      productoAtributo: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1',
          empresaId: 'e1',
          isActive: true,
          clave: 'fabricante',
          tipo: AtributoTipo.SELECT,
          valores: ['SAMSUNG', 'QUALCOMM'],
          dependeDeAtributoId: null,
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };

    const service = new ProductoAtributoService(
      prisma as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await service.update('a1', 'e1', { valores: ['Samsung', 'QUALCOMM'] } as any);

    // La opción se renombró en su lugar…
    expect(tx.productoAtributoOpcion.updateMany).toHaveBeenCalledWith({
      where: { atributoId: 'a1', valor: 'SAMSUNG' },
      data: { valor: 'Samsung' },
    });
    // …así que el sincronizador no tuvo nada que borrar: las hijas se salvan.
    expect(tx.productoAtributoOpcion.deleteMany).not.toHaveBeenCalled();
    // Y la cascada al valor guardado en los productos sigue corriendo.
    expect(tx.productoAtributoValor.updateMany).toHaveBeenCalledWith({
      where: { atributoId: 'a1', valor: 'SAMSUNG' },
      data: { valor: 'Samsung' },
    });
  });

  it('rechaza una dependencia que arma un ciclo', async () => {
    // a3 → a2 → a1 → a3
    const prisma = {
      productoAtributo: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a2',
          nombre: 'FAMILIA',
          tipo: AtributoTipo.SELECT_DEPENDIENTE,
          dependeDeAtributoId: 'a1',
        }),
        findUnique: jest.fn().mockResolvedValue({ dependeDeAtributoId: 'a3' }),
      },
    };
    const service = new ProductoAtributoService(
      prisma as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await expect(
      service['validarDependencia']('e1', 'a3', AtributoTipo.SELECT_DEPENDIENTE, 'a2'),
    ).rejects.toThrow(/ciclo/i);
  });

  it('no deja que un atributo de selección múltiple sea padre', async () => {
    const prisma = {
      productoAtributo: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1',
          nombre: 'COLORES',
          tipo: AtributoTipo.MULTI_SELECT,
          dependeDeAtributoId: null,
        }),
      },
    };
    const service = new ProductoAtributoService(
      prisma as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await expect(
      service['validarDependencia']('e1', 'a2', AtributoTipo.SELECT_DEPENDIENTE, 'a1'),
    ).rejects.toThrow(/selección múltiple/i);
  });

  it('una selección dependiente sin padre declarado no pasa', async () => {
    const service = new ProductoAtributoService(
      {} as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await expect(
      service['validarDependencia']('e1', null, AtributoTipo.SELECT_DEPENDIENTE, null),
    ).rejects.toThrow(/necesita el atributo del que depende/i);
  });

  it('resuelve padreValor al id de la opción del padre', async () => {
    const tx = {
      productoAtributoOpcion: {
        findMany: jest
          .fn()
          // 1ª llamada: las opciones propias (ninguna todavía)
          .mockResolvedValueOnce([])
          // 2ª: las del padre
          .mockResolvedValueOnce([{ id: 'padre-qc', valor: 'QUALCOMM' }]),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'o-nueva' }),
        deleteMany: jest.fn(),
      },
    };
    const service = new ProductoAtributoService(
      {} as any,
      mkLogger() as any,
      mkCache() as any,
    );

    const valores = await service['sincronizarOpciones'](tx as any, 'a2', 'a1', [
      { valor: 'Snapdragon 8 Gen', padreValor: 'QUALCOMM' },
    ]);

    expect(tx.productoAtributoOpcion.create).toHaveBeenCalledWith({
      data: {
        atributoId: 'a2',
        valor: 'Snapdragon 8 Gen',
        padreId: 'padre-qc',
        orden: 0,
      },
    });
    // El espejo plano sale de las mismas opciones.
    expect(valores).toEqual(['Snapdragon 8 Gen']);
  });

  /**
   * Renombrar DOS valores de una vez no se puede aparear, así que las viejas
   * caen como borradas y el cascade se llevaría sus ramas. Preferimos cortar.
   */
  it('no borra una opción que tiene hijas colgando', async () => {
    const tx = {
      productoAtributoOpcion: {
        findMany: jest
          .fn()
          // Las propias: QUALCOMM existe y no viene en la lista nueva.
          .mockResolvedValueOnce([
            { id: 'o-qc', valor: 'QUALCOMM', padreId: null, orden: 0 },
          ])
          // La consulta del freno: QUALCOMM tiene familias colgando.
          .mockResolvedValueOnce([
            { padre: { valor: 'QUALCOMM' } },
            { padre: { valor: 'QUALCOMM' } },
          ]),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'o-nueva' }),
        deleteMany: jest.fn(),
      },
    };
    const service = new ProductoAtributoService(
      {} as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await expect(
      service['sincronizarOpciones'](tx as any, 'a1', null, [
        { valor: 'Qualcomm' }, // renombrado sin id: la vieja se daría por borrada
      ]),
    ).rejects.toThrow(/QUALCOMM.*colgando/s);

    expect(tx.productoAtributoOpcion.deleteMany).not.toHaveBeenCalled();
  });

  it('falla si la opción dice colgar de un valor que el padre no tiene', async () => {
    const tx = {
      productoAtributoOpcion: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'padre-qc', valor: 'QUALCOMM' }]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const service = new ProductoAtributoService(
      {} as any,
      mkLogger() as any,
      mkCache() as any,
    );

    await expect(
      service['sincronizarOpciones'](tx as any, 'a2', 'a1', [
        { valor: 'Exynos 2200', padreValor: 'SAMSUNG' },
      ]),
    ).rejects.toThrow(/no tiene la opción "SAMSUNG"/);
  });
});

describe('ProductoCatalogService — filtro por valor de atributo', () => {
  const service = () =>
    new ProductoCatalogService({} as any, {} as any, mkLogger() as any);

  it('combina claves distintas con Y y valores de la misma clave con O', () => {
    const cond = service()['condicionesPorAtributo']([
      'fabricante:QUALCOMM',
      'fabricante:SAMSUNG',
      'ram:8GB',
    ]);

    // Dos grupos = dos condiciones que Prisma va a unir con AND.
    expect(cond).toHaveLength(2);

    const fabricante = cond[0].OR as any[];
    expect(fabricante[0].atributosValores.some).toEqual({
      atributo: { clave: 'fabricante' },
      valor: { in: ['QUALCOMM', 'SAMSUNG'] },
    });
  });

  it('busca el valor en el producto base Y en sus variantes', () => {
    const [cond] = service()['condicionesPorAtributo'](['color:Negro']);
    const ramas = cond.OR as any[];

    expect(ramas).toHaveLength(2);
    // Un producto con variantes no guarda el atributo en sí mismo.
    expect(ramas[1].variantes.some.deletedAt).toBeNull();
    expect(ramas[1].variantes.some.atributosValores.some.valor).toEqual({
      in: ['Negro'],
    });
  });

  it('parte en el PRIMER dos puntos, para que el valor pueda traer otro', () => {
    const [cond] = service()['condicionesPorAtributo'](['nota:12:30 hs']);
    const ramas = cond.OR as any[];

    expect(ramas[0].atributosValores.some).toEqual({
      atributo: { clave: 'nota' },
      valor: { in: ['12:30 hs'] },
    });
  });

  it('ignora entradas mal formadas y no filtra de más', () => {
    expect(service()['condicionesPorAtributo'](['sin-dos-puntos', ':vacio', 'x:'])).toEqual([]);
    expect(service()['condicionesPorAtributo'](undefined)).toEqual([]);
  });
});
