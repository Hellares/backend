import { VentaYapeTasksService } from './venta-yape-tasks.service';

/**
 * Tests del cron TTL de ventas Yape abandonadas. Verifica el branch clave de la
 * Fase 1: las ventas DIFERIDAS (cobroDiferido) se BORRAN (devuelven stock); las
 * legacy no-diferidas se ANULAN como antes. Idempotencia ante errores por venta.
 */
describe('VentaYapeTasksService.expirarVentasYapePendientes', () => {
  let service: VentaYapeTasksService;
  let prisma: any;
  let ventaService: any;
  let realtime: any;
  let integracionYape: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  beforeEach(() => {
    prisma = {
      venta: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    ventaService = {
      eliminarVentaYapeDiferidaPendiente: jest.fn().mockResolvedValue({ eliminada: true, yaPagada: false }),
      anular: jest.fn().mockResolvedValue({}),
    };
    realtime = { notifyStockCambiado: jest.fn() };
    // Por defecto no hay pagos recientes → el cron limpia como siempre.
    integracionYape = { listarPagosRecientes: jest.fn().mockResolvedValue([]) };

    service = new VentaYapeTasksService(
      prisma, ventaService, realtime, integracionYape, logger as any,
    );
  });

  it('venta DIFERIDA abandonada → se BORRA (no se anula)', async () => {
    prisma.venta.findMany.mockResolvedValue([
      { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true },
    ]);

    await service.expirarVentasYapePendientes();

    expect(ventaService.eliminarVentaYapeDiferidaPendiente).toHaveBeenCalledWith('v1', 'e1');
    expect(ventaService.anular).not.toHaveBeenCalled();
    expect(realtime.notifyStockCambiado).toHaveBeenCalledWith({ empresaId: 'e1', sedeId: 's1' });
  });

  it('venta LEGACY (no diferida) → se ANULA como antes', async () => {
    prisma.venta.findMany.mockResolvedValue([
      { id: 'v2', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-2', cobroDiferido: false },
    ]);

    await service.expirarVentasYapePendientes();

    expect(ventaService.anular).toHaveBeenCalledWith(
      'v2', 'e1', 'SYSTEM-YAPE-TTL', undefined, { soloSiPendienteSinPagos: true },
    );
    expect(prisma.venta.update).toHaveBeenCalled(); // sella motivoAnulacion
    expect(ventaService.eliminarVentaYapeDiferidaPendiente).not.toHaveBeenCalled();
  });

  it('batch mixto: cada venta toma su camino; un error no frena al resto', async () => {
    prisma.venta.findMany.mockResolvedValue([
      { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true },
      { id: 'v2', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-2', cobroDiferido: false },
    ]);
    ventaService.eliminarVentaYapeDiferidaPendiente.mockRejectedValueOnce(new Error('boom'));

    await service.expirarVentasYapePendientes();

    // v1 falló pero v2 igual se procesó (anular)
    expect(ventaService.anular).toHaveBeenCalledTimes(1);
  });

  it('sin candidatas: no hace nada', async () => {
    prisma.venta.findMany.mockResolvedValue([]);
    await service.expirarVentasYapePendientes();
    expect(ventaService.eliminarVentaYapeDiferidaPendiente).not.toHaveBeenCalled();
    expect(ventaService.anular).not.toHaveBeenCalled();
  });

  // El caso Geydy (07-20): pagó S/3, el nombre de Yape venía truncado
  // ("Geydy Sil*"), la conciliación falló y el TTL le borró la venta.
  describe('guard: pago reciente sin conciliar del mismo monto', () => {
    it('NO borra la venta si entró un Yape por ese monto en las últimas 24h', async () => {
      prisma.venta.findMany.mockResolvedValue([
        { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true, total: 3 },
      ]);
      integracionYape.listarPagosRecientes.mockResolvedValue([
        { id: 'p1', senderName: 'Geydy Sil*', amount: 3, provider: 'yape', receivedAt: '' },
      ]);

      await service.expirarVentasYapePendientes();

      expect(ventaService.eliminarVentaYapeDiferidaPendiente).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('VTA-1'));
    });

    it('sí la borra si el pago reciente es de OTRO monto', async () => {
      prisma.venta.findMany.mockResolvedValue([
        { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true, total: 3 },
      ]);
      integracionYape.listarPagosRecientes.mockResolvedValue([
        { id: 'p1', senderName: 'Otro', amount: 40, provider: 'yape', receivedAt: '' },
      ]);

      await service.expirarVentasYapePendientes();

      expect(ventaService.eliminarVentaYapeDiferidaPendiente).toHaveBeenCalledWith('v1', 'e1');
    });

    it('api-yape caída → no bloquea la limpieza (fail-open)', async () => {
      prisma.venta.findMany.mockResolvedValue([
        { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true, total: 3 },
      ]);
      integracionYape.listarPagosRecientes.mockRejectedValue(new Error('timeout'));

      await service.expirarVentasYapePendientes();

      expect(ventaService.eliminarVentaYapeDiferidaPendiente).toHaveBeenCalledWith('v1', 'e1');
    });

    it('consulta los pagos UNA vez por empresa, no por venta', async () => {
      prisma.venta.findMany.mockResolvedValue([
        { id: 'v1', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-1', cobroDiferido: true, total: 3 },
        { id: 'v2', empresaId: 'e1', sedeId: 's1', codigo: 'VTA-2', cobroDiferido: true, total: 5 },
        { id: 'v3', empresaId: 'e2', sedeId: 's9', codigo: 'VTA-3', cobroDiferido: true, total: 7 },
      ]);

      await service.expirarVentasYapePendientes();

      expect(integracionYape.listarPagosRecientes).toHaveBeenCalledTimes(2);
    });
  });
});
