import { ProductoAtributoValorService } from './producto-atributo-valor.service';

/**
 * Asignar un atributo SIN valor.
 *
 * El caso real: agregar CÓDIGO DE BARRAS a una variante para escanearlo
 * después. Antes era imposible —el `@IsNotEmpty` del DTO cortaba el pedido en
 * la puerta— y quien lo intentaba tenía que tener el código a mano en ese
 * mismo momento.
 *
 * La regla quedó así: vacío se acepta salvo que el atributo esté marcado como
 * `requerido`, que es la palanca que ya existía para eso.
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

/** Prisma mockeado con UN atributo, configurable por caso. */
const mkPrisma = (atributo: any) => {
  const tx = {
    productoAtributoValor: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productoVariante: { update: jest.fn().mockResolvedValue({}) },
    producto: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    productoVariante: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'v1',
        empresaId: 'e1',
        productoId: 'p1',
        nombre: 'AZUL',
      }),
    },
    productoAtributo: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'a1', empresaId: 'e1', isActive: true, ...atributo },
      ]),
    },
    $transaction: jest.fn(async (cb: any) => await cb(tx)),
  };

  return { prisma, tx };
};

const svc = (prisma: any) =>
  new ProductoAtributoValorService(prisma as any, mkLogger() as any, mkCache() as any);

const vacio = { atributos: [{ atributoId: 'a1', valor: '' }] };

describe('setVarianteAtributos — valor vacío', () => {
  it('guarda el atributo sin valor si NO es requerido', async () => {
    const { prisma, tx } = mkPrisma({
      nombre: 'CODIGO',
      tipo: 'CODIGO_BARRAS',
      requerido: false,
      valores: [],
      dependeDeAtributoId: null,
    });

    await svc(prisma).setVarianteAtributos('e1', 'v1', vacio as any);

    // La fila se crea igual: el campo queda asignado a la variante, listo para
    // llenarse después.
    expect(tx.productoAtributoValor.createMany).toHaveBeenCalledWith({
      data: [{ varianteId: 'v1', atributoId: 'a1', valor: '' }],
    });
  });

  it('rechaza el vacío si el atributo es requerido', async () => {
    const { prisma } = mkPrisma({
      nombre: 'COLOR',
      tipo: 'SELECT',
      requerido: true,
      valores: ['AZUL', 'ROJO'],
      dependeDeAtributoId: null,
    });

    await expect(
      svc(prisma).setVarianteAtributos('e1', 'v1', vacio as any),
    ).rejects.toThrow(/requerido/i);
  });

  /**
   * 🔴 El chequeo del vacío tiene que correr ANTES del switch por tipo. Si
   * cayera adentro, un SELECT lo rechazaría con "solo acepta los valores:
   * AZUL, ROJO" —un mensaje que no tiene sentido para un campo que se dejó en
   * blanco a propósito— y un dependiente diría que no tiene esa opción.
   */
  it('un SELECT con lista no rechaza el vacío por "valor no permitido"', async () => {
    const { prisma, tx } = mkPrisma({
      nombre: 'COLOR',
      tipo: 'SELECT',
      requerido: false,
      valores: ['AZUL', 'ROJO'],
      dependeDeAtributoId: null,
    });

    await svc(prisma).setVarianteAtributos('e1', 'v1', vacio as any);

    expect(tx.productoAtributoValor.createMany).toHaveBeenCalled();
  });

  it('con valor cargado sigue validando contra la lista', async () => {
    const { prisma } = mkPrisma({
      nombre: 'COLOR',
      tipo: 'SELECT',
      requerido: false,
      valores: ['AZUL', 'ROJO'],
      dependeDeAtributoId: null,
    });

    await expect(
      svc(prisma).setVarianteAtributos('e1', 'v1', {
        atributos: [{ atributoId: 'a1', valor: 'VERDE' }],
      } as any),
    ).rejects.toThrow(/solo acepta los valores/i);
  });
});
