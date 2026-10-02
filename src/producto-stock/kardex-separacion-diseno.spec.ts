import { ProductoStockService } from './producto-stock.service';

/**
 * Kardex de una variante que nació de "Separar por diseño".
 *
 * Invariantes:
 * - Trae también el historial de la variante original, pero SOLO lo anterior
 *   a la separación (lo de después ya es de los otros diseños).
 * - Lo heredado va marcado (`heredado`, `heredadoDe`).
 * - El resumen suma solo lo propio: si no, las entradas y salidas de esta
 *   variante se inflan con las de la original.
 * - Una variante que no viene de una separación se consulta como siempre.
 *
 * Caso real: VAR-000087 (JAYLI) se separó el 02-10-2026 en …/D1 y el kardex
 * de D1 mostraba una sola fila; la compra y las ventas quedaban en la
 * original, ya inactiva.
 */

const SEPARACION = new Date('2026-10-02T07:04:07.640Z');
const MOTIVO = 'Separación por diseño: CRISTAL → CRISTAL / D1';

const mov = (id: string, productoStockId: string, tipo: string, creadoEn: string) => ({
  id, productoStockId, tipo, creadoEn: new Date(creadoEn), usuarioId: 'u1',
});

const make = (opts: { separada: boolean }) => {
  const prisma: any = {
    movimientoStock: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (!opts.separada) return Promise.resolve(null);
        // La entrada por separación en el stock nuevo…
        if (where.tipo === 'PRODUCCION_ENTRADA') {
          return Promise.resolve(
            where.productoStockId === 'ps-d1'
              ? { motivo: MOTIVO, creadoEn: new Date(SEPARACION.getTime() + 72), sedeId: 's1', empresaId: 'e1' }
              : null,
          );
        }
        // …y su salida gemela en el stock original.
        return Promise.resolve({
          productoStockId: 'ps-original',
          creadoEn: SEPARACION,
          productoStock: { varianteId: 'var-original', variante: { nombre: 'CRISTAL' } },
        });
      }),
      findMany: jest.fn().mockResolvedValue([
        mov('m3', 'ps-d1', 'PRODUCCION_ENTRADA', '2026-10-02T07:04:07.712Z'),
        mov('m2', 'ps-original', 'SALIDA_VENTA', '2026-09-16T22:58:13.190Z'),
        mov('m1', 'ps-original', 'ENTRADA_COMPRA', '2026-08-11T21:34:22.636Z'),
      ]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    productoStock: { findUnique: jest.fn().mockResolvedValue({ productoId: null, varianteId: 'var-d1' }) },
    usuario: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ProductoStockService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma };
};

describe('Kardex de una variante separada por diseño', () => {
  it('trae lo propio y lo de la variante original anterior a la separación', async () => {
    const { service, prisma } = make({ separada: true });
    const res = await service.getHistorialMovimientos('ps-d1');
    const where = prisma.movimientoStock.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { productoStockId: 'ps-d1' },
      { productoStockId: 'ps-original', creadoEn: { lt: SEPARACION } },
    ]);
    expect(res.movimientos.map((m: any) => [m.id, m.heredado, m.heredadoDe])).toEqual([
      ['m3', false, null],
      ['m2', true, 'CRISTAL'],
      ['m1', true, 'CRISTAL'],
    ]);
  });

  it('la línea de venta de un movimiento heredado se busca en la variante original', async () => {
    const { service, prisma } = make({ separada: true });
    await service.getHistorialMovimientos('ps-d1');
    const include = prisma.movimientoStock.findMany.mock.calls[0][0].include;
    expect(include.venta.select.detalles.where).toEqual({ varianteId: { in: ['var-d1', 'var-original'] } });
  });

  it('el resumen suma solo lo propio', async () => {
    const { service, prisma } = make({ separada: true });
    await service.getHistorialMovimientos('ps-d1', { tipo: 'SALIDA_VENTA' });
    const where = prisma.movimientoStock.groupBy.mock.calls[0][0].where;
    expect(where.productoStockId).toBe('ps-d1');
    expect(where.OR).toBeUndefined();
    expect(where.AND).toEqual([{ tipo: 'SALIDA_VENTA' }]);
  });

  it('los filtros se suman al OR sin pisarlo', async () => {
    const { service, prisma } = make({ separada: true });
    await service.getHistorialMovimientos('ps-d1', { documento: '814' });
    const where = prisma.movimientoStock.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.AND[0].OR[0]).toEqual({ numeroDocumento: { contains: '814', mode: 'insensitive' } });
  });

  it('una variante que no viene de una separación se consulta como siempre', async () => {
    const { service, prisma } = make({ separada: false });
    prisma.movimientoStock.findMany.mockResolvedValue([
      mov('m3', 'ps-d1', 'ENTRADA_COMPRA', '2026-10-02T07:04:07.712Z'),
    ]);
    const res = await service.getHistorialMovimientos('ps-d1');
    const where = prisma.movimientoStock.findMany.mock.calls[0][0].where;
    expect(where.productoStockId).toBe('ps-d1');
    expect(where.OR).toBeUndefined();
    expect(res.movimientos.every((m: any) => m.heredado === false)).toBe(true);
  });
});
