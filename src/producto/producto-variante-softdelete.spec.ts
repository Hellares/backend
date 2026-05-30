import { ProductoVarianteService } from './producto-variante.service';

/**
 * Tests del soft-delete de variantes: verifica que al borrar una variante se
 * bumpee el `Producto.actualizadoEn` del padre EN LA MISMA TRANSACCIÓN, para
 * que el delta-sync traiga el producto actualizado (sin la variante) y los
 * clientes no la sigan mostrando. También que notifica al padre.
 *
 * Mockeamos las dependencias del service (no usa infra real).
 */
describe('ProductoVarianteService.remove — soft-delete propaga al padre', () => {
  const mkLogger = () => ({
    setContext: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  it('soft-deletea la variante Y bumpea el Producto padre + notifica (1 tx)', async () => {
    const tx = {
      productoVariante: { update: jest.fn().mockResolvedValue({}) },
      producto: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      productoVariante: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1',
          productoId: 'p1',
          empresaId: 'e1',
          deletedAt: null,
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const cache = {
      invalidateProductosLists: jest.fn().mockResolvedValue(undefined),
    };
    const realtime = { notifyProductoActualizado: jest.fn() };

    const service = new ProductoVarianteService(
      prisma as any,
      cache as any,
      {} as any,
      realtime as any,
      mkLogger() as any,
    );

    await service.remove('v1', 'e1');

    // 1) soft-delete de la variante
    expect(tx.productoVariante.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { deletedAt: expect.any(Date) },
    });
    // 2) BUMP del Producto padre (el fix) — sin esto el delta-sync no lo trae
    expect(tx.producto.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { actualizadoEn: expect.any(Date) },
    });
    // 3) ambas mutaciones en UNA sola transacción
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 4) notifica al padre para refresco en otros devices
    expect(realtime.notifyProductoActualizado).toHaveBeenCalledWith({
      empresaId: 'e1',
      productoId: 'p1',
    });
    // 5) invalida cache de listados
    expect(cache.invalidateProductosLists).toHaveBeenCalledWith('e1');
  });

  it('si la variante no existe → NotFound y NO abre transacción', async () => {
    const prisma = {
      productoVariante: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const realtime = { notifyProductoActualizado: jest.fn() };

    const service = new ProductoVarianteService(
      prisma as any,
      {} as any,
      {} as any,
      realtime as any,
      mkLogger() as any,
    );

    await expect(service.remove('vX', 'e1')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(realtime.notifyProductoActualizado).not.toHaveBeenCalled();
  });
});
