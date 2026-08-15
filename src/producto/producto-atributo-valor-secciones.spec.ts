import { ProductoAtributoValorService } from './producto-atributo-valor.service';

/**
 * Guardar la ficha técnica desde el DETALLE del producto.
 *
 * El endpoint REEMPLAZA los atributos (deleteMany + createMany), así que quien
 * llama manda la ficha completa. Lo que se prueba acá es lo otro que tiene que
 * pasar en la misma transacción: que la sección aplicada quede registrada —sin
 * pisar las que ya estaban— y que el producto se marque como actualizado, que
 * es lo único que hace que el cambio llegue al celular por delta-sync.
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

/** Prisma mockeado: `producto` es el estado que se supone guardado. */
const mkPrisma = (producto: any) => {
  const tx = {
    productoAtributoValor: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          atributoId: 'a1',
          valor: 'QUALQON',
          atributo: { nombre: 'Fabricante', clave: 'fabricante', tipo: 'SELECT', unidad: null },
        },
      ]),
    },
    producto: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    producto: { findFirst: jest.fn().mockResolvedValue(producto) },
    productoAtributo: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'a1',
          empresaId: 'e1',
          isActive: true,
          tipo: 'TEXTO',
          nombre: 'Fabricante',
          valores: [],
          dependeDeAtributoId: null,
        },
      ]),
    },
    $transaction: jest.fn(async (cb: any) => await cb(tx)),
  };

  return { prisma, tx };
};

const svc = (prisma: any) =>
  new ProductoAtributoValorService(prisma as any, mkLogger() as any);

describe('setProductoAtributos — secciones de la ficha técnica', () => {
  const dto = { atributos: [{ atributoId: 'a1', valor: 'QUALQON' }] };

  it('SUMA la sección aplicada a las que el producto ya tenía', async () => {
    const { prisma, tx } = mkPrisma({
      id: 'p1',
      empresaId: 'e1',
      plantillasAtributosIds: ['pl-procesador'],
    });

    await svc(prisma).setProductoAtributos('e1', 'p1', {
      ...dto,
      plantillasAtributosIds: ['pl-memoria'],
    } as any);

    expect(tx.producto.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({
          plantillasAtributosIds: ['pl-procesador', 'pl-memoria'],
        }),
      }),
    );
  });

  it('no repite una sección que ya estaba aplicada', async () => {
    const { prisma, tx } = mkPrisma({
      id: 'p1',
      empresaId: 'e1',
      plantillasAtributosIds: ['pl-procesador'],
    });

    await svc(prisma).setProductoAtributos('e1', 'p1', {
      ...dto,
      plantillasAtributosIds: ['pl-procesador'],
    } as any);

    expect(tx.producto.update.mock.calls[0][0].data.plantillasAtributosIds).toEqual([
      'pl-procesador',
    ]);
  });

  it('sin secciones en el payload deja las guardadas intactas', async () => {
    const { prisma, tx } = mkPrisma({
      id: 'p1',
      empresaId: 'e1',
      plantillasAtributosIds: ['pl-procesador'],
    });

    await svc(prisma).setProductoAtributos('e1', 'p1', dto as any);

    expect(tx.producto.update.mock.calls[0][0].data.plantillasAtributosIds).toEqual([
      'pl-procesador',
    ]);
  });

  /**
   * Sin el bump, el delta-sync del app —que pide productos por
   * `actualizadoEn`— nunca se entera de que la ficha cambió: los atributos
   * quedan bien en la base y el celular sigue mostrando los viejos, sin ningún
   * error que lo delate.
   */
  it('marca el producto como actualizado en la MISMA transacción', async () => {
    const { prisma, tx } = mkPrisma({
      id: 'p1',
      empresaId: 'e1',
      plantillasAtributosIds: [],
    });

    await svc(prisma).setProductoAtributos('e1', 'p1', dto as any);

    expect(tx.producto.update.mock.calls[0][0].data.actualizadoEn).toBeInstanceOf(Date);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
