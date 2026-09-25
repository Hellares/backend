import { BadRequestException } from '@nestjs/common';
import { PedidoMarketplaceService } from './pedido-marketplace.service';

/**
 * Retiro en tienda en el checkout: la empresa tiene que ofrecerlo y la sede
 * tiene que ser suya. Antes se aceptaba cualquier `sedeRetiroId` (hasta de
 * otra empresa) y con él se elegía la sede de la venta.
 */
describe('PedidoMarketplaceService.sedeRetiroValida', () => {
  function armar({ permite = true, sedes = ['sede-1'] }: { permite?: boolean; sedes?: string[] } = {}) {
    const prisma: any = {
      empresa: { findUnique: jest.fn().mockResolvedValue({ nombre: 'JAYLILAND', permiteRetiroTienda: permite }) },
      sede: { findMany: jest.fn().mockResolvedValue(sedes.map((id) => ({ id }))) },
    };
    const service = new PedidoMarketplaceService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const validar = (sedeId?: string | null) => (service as any).sedeRetiroValida('empresa-1', sedeId);
    return { validar, prisma };
  }

  it('empresa que no ofrece retiro → 400', async () => {
    const { validar } = armar({ permite: false });
    await expect(validar('sede-1')).rejects.toThrow('no ofrece retiro en tienda');
  });

  it('sede de OTRA empresa → 400 (no se cuela en la venta)', async () => {
    const { validar, prisma } = armar({ sedes: ['sede-1', 'sede-2'] });
    await expect(validar('sede-de-otra-empresa')).rejects.toBeInstanceOf(BadRequestException);
    // Solo se miran las sedes activas de ESTA empresa.
    expect(prisma.sede.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { empresaId: 'empresa-1', isActive: true, deletedAt: null },
    }));
  });

  it('sede propia → la usa', async () => {
    const { validar } = armar({ sedes: ['sede-1', 'sede-2'] });
    await expect(validar('sede-2')).resolves.toBe('sede-2');
  });

  it('sin elegir y con una sola sede → esa', async () => {
    const { validar } = armar({ sedes: ['sede-unica'] });
    await expect(validar(null)).resolves.toBe('sede-unica');
  });

  it('sin elegir y con varias sedes → pide elegir', async () => {
    const { validar } = armar({ sedes: ['sede-1', 'sede-2'] });
    await expect(validar(undefined)).rejects.toThrow('Elige en qué tienda');
  });
});
