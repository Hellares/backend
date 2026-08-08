import { ProductoVarianteService } from './producto-variante.service';

/**
 * En qué sedes nace el stock de una variante nueva.
 *
 * El bug: la consulta que deduce las sedes filtra `deletedAt: null`, así que
 * borrar TODAS las variantes de un producto la deja en cero — y el fallback
 * creaba stock en todas las sedes activas de la empresa. Un producto de una
 * sola sede terminaba con filas, y con precios, en sedes donde no existe.
 *
 * Pasó en beta con ALIMENTO PARA RATON, creado solo para Sede Principal: se
 * borró la variante por defecto que la conversión había creado (la única que
 * cargaba la fila de stock original) y la siguiente tanda se generó en las dos
 * sedes de la empresa.
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const mkService = (
  opts: {
    /** `null` = producto viejo, sin la columna cargada. */
    sedeDelProducto?: string | null;
    stocksExistentes?: any[];
  } = {},
) => {
  const prisma = {
    productoStock: {
      findMany: jest.fn().mockResolvedValue(opts.stocksExistentes ?? []),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    producto: {
      findFirst: jest.fn().mockResolvedValue({
        sedeId:
          opts.sedeDelProducto === undefined
            ? 'sede-principal'
            : opts.sedeDelProducto,
      }),
    },
    sede: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'sede-principal' }, { id: 'sede-chiclayo' }]),
    },
  };
  const service = new ProductoVarianteService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    mkLogger() as any,
  );
  return { service, prisma };
};

/// El método traga sus errores y solo loguea, así que leer el createMany es la
/// única forma de saber que llegó hasta el final.
const sedesCreadas = (prisma: any): string[] =>
  prisma.productoStock.createMany.mock.calls[0][0].data.map(
    (d: any) => d.sedeId,
  );

describe('sedes donde nace el stock de una variante', () => {
  it('🔴 sin filas previas usa la sede DEL PRODUCTO, no todas las activas', async () => {
    const { service, prisma } = mkService();

    await (service as any).crearProductoStockEnSedes('v1', 'p1', 'e1');

    expect(sedesCreadas(prisma)).toEqual(['sede-principal']);
    // Ni siquiera se pregunta por las sedes de la empresa.
    expect(prisma.sede.findMany).not.toHaveBeenCalled();
  });

  it('respeta las sedes donde el producto ya tiene stock', async () => {
    const { service, prisma } = mkService({
      stocksExistentes: [
        {
          sedeId: 'sede-chiclayo',
          varianteId: null,
          precio: null,
          precioCosto: null,
          precioConfigurado: false,
        },
      ],
    });

    await (service as any).crearProductoStockEnSedes('v1', 'p1', 'e1');

    expect(sedesCreadas(prisma)).toEqual(['sede-chiclayo']);
    expect(prisma.producto.findFirst).not.toHaveBeenCalled();
  });

  it('cae a todas las activas solo si el producto no tiene sede', async () => {
    const { service, prisma } = mkService({ sedeDelProducto: null });

    await (service as any).crearProductoStockEnSedes('v1', 'p1', 'e1');

    expect(sedesCreadas(prisma)).toEqual(['sede-principal', 'sede-chiclayo']);
  });
});
