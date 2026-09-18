import { ConflictException } from '@nestjs/common';
import { VentaService } from './venta.service';

/**
 * Aviso de VENTA REPETIDA (09-16, VTA-814/815): la cajera rehizo una venta
 * ya cobrada para agregarle cliente y envío, y el stock salió dos veces.
 * `avisarSiVentaRepetida` rechaza con 409 si la misma cajera cobró hace
 * menos de 3 min una venta con los MISMOS productos y cantidades. Igual que
 * el spec de cobroYape: se invoca sobre un `this` falso.
 */
const avisar: (empresaId: string, dto: any, cajeroId: string) => Promise<void> = (
  VentaService.prototype as any
).avisarSiVentaRepetida;

const EDREDON = { productoId: 'prod-edredon', varianteId: 'var-cristal' };
const ALMOHADA = { productoId: 'prod-almohada', varianteId: null };

const dto = (over: any = {}) => ({
  sedeId: 'sede-1',
  avisarVentaRepetida: true,
  detalles: [
    { ...EDREDON, cantidad: 1 },
    { ...ALMOHADA, cantidad: 2 },
  ],
  ...over,
});

const ventaPrevia = (over: any = {}) => ({
  id: 'venta-814',
  codigo: 'VTA-SED-00000814',
  total: '83.00', // Decimal de Prisma
  nombreCliente: 'CLIENTES VARIOS',
  estado: 'PAGADA_COMPLETA',
  creadoEn: new Date(Date.now() - 18_000),
  // Guardadas en OTRO orden y con la cantidad como Decimal ("2.00").
  detalles: [
    { ...ALMOHADA, servicioId: null, comboId: null, ordenServicioId: null, cantidad: '2.00' },
    { ...EDREDON, servicioId: null, comboId: null, ordenServicioId: null, cantidad: '1.00' },
  ],
  ...over,
});

const armarThis = (recientes: any[] = []) => ({
  prisma: { venta: { findMany: jest.fn().mockResolvedValue(recientes) } },
});

describe('VentaService.avisarSiVentaRepetida', () => {
  it('caso 814/815: mismos productos y cantidades hace 18 s → 409 VENTA_REPETIDA con esa venta', async () => {
    const ctx = armarThis([ventaPrevia()]);

    const err = await avisar.call(ctx, 'emp-1', dto(), 'cajera-1').catch((e: any) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = err.getResponse();
    expect(body).toMatchObject({
      code: 'VENTA_REPETIDA',
      venta: {
        id: 'venta-814',
        codigo: 'VTA-SED-00000814',
        nombreCliente: 'CLIENTES VARIOS',
        total: 83,
        estado: 'PAGADA_COMPLETA',
      },
    });
    expect(body.venta.segundos).toBeGreaterThanOrEqual(17);
    expect(body.message).toContain('VTA-SED-00000814');
  });

  it('solo mira la MISMA cajera, la misma sede, ventas de caja no anuladas de los últimos 3 min', async () => {
    const ctx = armarThis([]);
    const antes = Date.now();

    await avisar.call(ctx, 'emp-1', dto(), 'cajera-1');

    const where = ctx.prisma.venta.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      empresaId: 'emp-1',
      sedeId: 'sede-1',
      cajeroId: 'cajera-1',
      canalVenta: { in: ['POS', 'COTIZACION'] },
      estado: { not: 'ANULADA' },
    });
    const desde = where.creadoEn.gte.getTime();
    expect(antes - desde).toBeGreaterThanOrEqual(3 * 60_000 - 50);
    expect(antes - desde).toBeLessThanOrEqual(3 * 60_000 + 50);
  });

  it('la cajera confirmó que es OTRA venta → pasa sin consultar', async () => {
    const ctx = armarThis([ventaPrevia()]);

    await expect(
      avisar.call(ctx, 'emp-1', dto({ ventaRepetidaConfirmada: true }), 'cajera-1'),
    ).resolves.toBeUndefined();
    expect(ctx.prisma.venta.findMany).not.toHaveBeenCalled();
  });

  it('cliente que NO pide el aviso (web, APK viejo) → nunca se rechaza', async () => {
    const ctx = armarThis([ventaPrevia()]);

    await expect(
      avisar.call(ctx, 'emp-1', dto({ avisarVentaRepetida: undefined }), 'cajera-1'),
    ).resolves.toBeUndefined();
    expect(ctx.prisma.venta.findMany).not.toHaveBeenCalled();
  });

  it('otra CANTIDAD → no es la misma venta', async () => {
    const ctx = armarThis([ventaPrevia()]);
    const otra = dto({
      detalles: [
        { ...EDREDON, cantidad: 2 },
        { ...ALMOHADA, cantidad: 2 },
      ],
    });

    await expect(avisar.call(ctx, 'emp-1', otra, 'cajera-1')).resolves.toBeUndefined();
  });

  it('otra VARIANTE del mismo producto → no es la misma venta', async () => {
    const ctx = armarThis([ventaPrevia()]);
    const otra = dto({
      detalles: [
        { ...EDREDON, varianteId: 'var-kitty', cantidad: 1 },
        { ...ALMOHADA, cantidad: 2 },
      ],
    });

    await expect(avisar.call(ctx, 'emp-1', otra, 'cajera-1')).resolves.toBeUndefined();
  });

  it('un producto de MÁS o de menos → no es la misma venta', async () => {
    const ctx = armarThis([ventaPrevia()]);
    const menos = dto({ detalles: [{ ...EDREDON, cantidad: 1 }] });

    await expect(avisar.call(ctx, 'emp-1', menos, 'cajera-1')).resolves.toBeUndefined();
  });

  it('entre varias recientes encuentra la que coincide', async () => {
    const ctx = armarThis([
      ventaPrevia({
        id: 'venta-otra',
        codigo: 'VTA-OTRA',
        detalles: [{ ...ALMOHADA, cantidad: '5.00' }],
      }),
      ventaPrevia(),
    ]);

    const err = await avisar.call(ctx, 'emp-1', dto(), 'cajera-1').catch((e: any) => e);

    expect(err.getResponse().venta.codigo).toBe('VTA-SED-00000814');
  });
});
