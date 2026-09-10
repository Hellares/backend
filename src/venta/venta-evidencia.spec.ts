import { VentaService } from './venta.service';

/**
 * El enganche de las fotos a la venta recién creada.
 *
 * La foto se sube MIENTRAS se cobra, así que existe antes que la venta y con
 * `entidadId` en null. Al crear la venta se enganchan por id.
 *
 * 🔴 Lo que se prueba acá es el `where`: sin `empresaId` y sin
 * `entidadId: null`, mandar el id de una foto de OTRA venta se la robaría a
 * esa venta.
 */
const vincular = (
  tx: any,
  empresaId: string,
  ventaId: string,
  ids?: string[],
) =>
  (VentaService.prototype as any).vincularEvidencia.call(
    { logger: { warn: jest.fn() } },
    tx,
    empresaId,
    ventaId,
    ids,
  );

const txCon = (count: number) => ({
  archivo: { updateMany: jest.fn().mockResolvedValue({ count }) },
});

describe('VentaService.vincularEvidencia', () => {
  it('sin ids no toca la base', async () => {
    const tx = txCon(0);
    await vincular(tx, 'emp-1', 'venta-1', undefined);
    await vincular(tx, 'emp-1', 'venta-1', []);
    expect(tx.archivo.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 filtra por empresa y por entidadId NULL', async () => {
    const tx = txCon(1);
    await vincular(tx, 'emp-1', 'venta-1', ['arch-1']);

    const args = tx.archivo.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      id: { in: ['arch-1'] },
      empresaId: 'emp-1',
      entidadTipo: 'VENTA',
      // Sin esto, una foto que YA es de otra venta se la robaría.
      entidadId: null,
      deletedAt: null,
    });
    expect(args.data).toEqual({ entidadId: 'venta-1' });
  });

  it('deduplica los ids repetidos y descarta los vacíos', async () => {
    const tx = txCon(2);
    await vincular(tx, 'emp-1', 'venta-1', ['a', 'b', 'a', '', 'b']);

    expect(tx.archivo.updateMany.mock.calls[0][0].where.id.in).toEqual([
      'a',
      'b',
    ]);
  });

  it('si engancharon menos de las pedidas NO tira: la venta ya está cobrada', async () => {
    const tx = txCon(1);
    await expect(
      vincular(tx, 'emp-1', 'venta-1', ['a', 'b']),
    ).resolves.toBeUndefined();
  });
});
