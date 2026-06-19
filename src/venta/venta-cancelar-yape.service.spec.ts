import { EstadoVenta } from '@prisma/client';
import { VentaService } from './venta.service';

/**
 * Tests del CANCELAR/EXPIRAR de ventas Yape DIFERIDAS: deben BORRARSE (devolver
 * stock), NO quedar ANULADAS. Cubre la carrera con el webhook (si pagó justo
 * antes → no borrar, yaPagada) y el camino legacy (no diferida → anular).
 */
describe('VentaService — cancelar/eliminar venta Yape diferida', () => {
  let service: VentaService;
  let prisma: any;
  let tx: any;
  let integracionYape: any;
  let realtimeInvalidation: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  const ventaDiferida = (over: any = {}) => ({
    id: 'venta-1',
    sedeId: 'sede-1',
    estado: EstadoVenta.CONFIRMADA,
    cobroDiferido: true,
    pagos: [],
    detalles: [{ productoId: 'prod-1', varianteId: null, cantidad: 2 }],
    ...over,
  });

  beforeEach(() => {
    tx = {
      venta: {
        findFirst: jest.fn().mockResolvedValue({ estado: EstadoVenta.CONFIRMADA, pagos: [] }),
        delete: jest.fn().mockResolvedValue({}),
      },
      productoStock: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ps-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      movimientoStock: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      descuentoUsoHistorial: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ventaDetalle: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      venta: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    integracionYape = { cancelarCobro: jest.fn().mockResolvedValue(0) };
    realtimeInvalidation = { notifyStockCambiado: jest.fn() };

    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, realtimeInvalidation,
      integracionYape, logger as any,
    );
    jest.spyOn(service as any, 'invalidateProductCache').mockResolvedValue(undefined);
  });

  describe('eliminarVentaYapeDiferidaPendiente', () => {
    it('diferida CONFIRMADA sin pagos: borra venta+detalles+movimientos y DEVUELVE stock', async () => {
      prisma.venta.findFirst.mockResolvedValue(ventaDiferida());

      const r = await service.eliminarVentaYapeDiferidaPendiente('venta-1', 'emp-1');

      expect(r).toEqual({ eliminada: true, yaPagada: false });
      // Stock devuelto (+2)
      expect(tx.productoStock.update).toHaveBeenCalledWith({
        where: { id: 'ps-1' },
        data: { stockActual: { increment: 2 } },
      });
      // Borrado de hijos + venta (sin dejar ANULADA)
      expect(tx.movimientoStock.deleteMany).toHaveBeenCalledWith({ where: { ventaId: 'venta-1' } });
      expect(tx.ventaDetalle.deleteMany).toHaveBeenCalledWith({ where: { ventaId: 'venta-1' } });
      expect(tx.venta.delete).toHaveBeenCalledWith({ where: { id: 'venta-1' } });
      expect(realtimeInvalidation.notifyStockCambiado).toHaveBeenCalled();
    });

    it('pago llegó justo antes (pagos>0): NO borra, devuelve yaPagada', async () => {
      prisma.venta.findFirst.mockResolvedValue(
        ventaDiferida({ estado: EstadoVenta.PAGADA_COMPLETA, pagos: [{ monto: 50 }] }),
      );

      const r = await service.eliminarVentaYapeDiferidaPendiente('venta-1', 'emp-1');

      expect(r).toEqual({ eliminada: false, yaPagada: true });
      expect(tx.venta.delete).not.toHaveBeenCalled();
    });

    it('venta no diferida / inexistente: no hace nada', async () => {
      prisma.venta.findFirst.mockResolvedValue(null);
      const r = await service.eliminarVentaYapeDiferidaPendiente('venta-1', 'emp-1');
      expect(r).toEqual({ eliminada: false, yaPagada: false });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('carrera: re-validación en tx detecta que ya no está pendiente → no borra', async () => {
      prisma.venta.findFirst.mockResolvedValue(ventaDiferida());
      tx.venta.findFirst.mockResolvedValue({ estado: EstadoVenta.CONFIRMADA, pagos: [{ id: 'p1' }] });

      const r = await service.eliminarVentaYapeDiferidaPendiente('venta-1', 'emp-1');
      expect(r.eliminada).toBe(false);
      expect(tx.venta.delete).not.toHaveBeenCalled();
    });
  });

  describe('cancelarCobroYapePendiente', () => {
    it('diferida: libera charge y delega en el borrado', async () => {
      prisma.venta.findFirst
        // 1ra llamada: la del propio cancelarCobroYapePendiente
        .mockResolvedValueOnce({ ...ventaDiferida(), estado: EstadoVenta.CONFIRMADA })
        // 2da llamada: la de eliminarVentaYapeDiferidaPendiente
        .mockResolvedValueOnce(ventaDiferida());

      const r = await service.cancelarCobroYapePendiente('venta-1', 'emp-1', 'caj-1');

      expect(integracionYape.cancelarCobro).toHaveBeenCalledWith({ empresaId: 'emp-1', ventaId: 'venta-1' });
      expect(r).toEqual({ anulada: true, yaPagada: false });
      expect(tx.venta.delete).toHaveBeenCalled();
    });

    it('ya pagada (carrera webhook): no borra, yaPagada=true', async () => {
      prisma.venta.findFirst.mockResolvedValue({
        estado: EstadoVenta.PAGADA_COMPLETA,
        cobroDiferido: true,
        pagos: [{ monto: 50 }],
        sedeId: 'sede-1',
        detalles: [],
      });

      const r = await service.cancelarCobroYapePendiente('venta-1', 'emp-1', 'caj-1');
      expect(r).toEqual({ anulada: false, yaPagada: true });
      expect(tx.venta.delete).not.toHaveBeenCalled();
    });
  });
});
