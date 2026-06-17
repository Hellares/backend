import { EstadoVenta, MetodoPagoVenta } from '@prisma/client';
import { WebhooksService } from './webhooks.service';

/**
 * Tests de `procesarPagoYape` — el handler que CIERRA la venta cuando api-yape
 * confirma un pago. Cubre las rutas críticas para producción:
 *  - idempotencia (venta ya pagada / anulada),
 *  - cálculo del PENDIENTE (clave del pago MIXTO: solo cobra la porción Yape),
 *  - mapeo provider→método (yape/plin),
 *  - cortocircuitos (cuenta no mapeada, evento ignorado, sin referencia, etc.).
 *
 * Sin DB: mockeamos verificarWebhook, prisma.venta.findFirst, ventaService y realtime.
 */
describe('WebhooksService.procesarPagoYape', () => {
  let integracionYape: any;
  let prisma: any;
  let ventaService: any;
  let realtime: any;
  let service: WebhooksService;

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  };

  const RAW = Buffer.from('{}', 'utf8');
  const FIRMA = 'sha256=x';

  // Hace que verificarWebhook resuelva con la empresa + el payload dado.
  const conPayload = (payload: any, empresaId = 'emp-1') =>
    integracionYape.verificarWebhook.mockResolvedValue({ empresaId, payload });

  const payloadPago = (over: any = {}) => ({
    event: 'payment.confirmed',
    charge: { reference: 'venta-1' },
    payment: { provider: 'yape', operationCode: 'OP-123', id: 'pay-1' },
    ...over,
  });

  beforeEach(() => {
    integracionYape = { verificarWebhook: jest.fn() };
    prisma = { venta: { findFirst: jest.fn() } };
    ventaService = { procesarPago: jest.fn().mockResolvedValue({}) };
    realtime = { notifyVentaPagada: jest.fn() };
    service = new WebhooksService(
      prisma,
      logger as any,
      integracionYape,
      ventaService,
      realtime,
    );
  });

  it('happy path 100% Yape: cobra el total, mapea YAPE, registra en caja del cajero, notifica', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.CONFIRMADA,
      total: 50,
      cajeroId: 'caj-1',
      pagos: [],
    });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(r).toMatchObject({ ok: true, accion: 'pagada', ventaId: 'venta-1' });
    expect(ventaService.procesarPago).toHaveBeenCalledWith(
      'venta-1',
      'emp-1',
      expect.objectContaining({
        metodoPago: MetodoPagoVenta.YAPE,
        monto: 50,
        referencia: 'OP-123',
      }),
      'caj-1', // cajero que creó la venta → su caja recibe el INGRESO Yape
      { skipCajaValidacion: true }, // pero sin exigir caja abierta
    );
    expect(realtime.notifyVentaPagada).toHaveBeenCalledWith({
      empresaId: 'emp-1',
      ventaId: 'venta-1',
    });
  });

  it('pago MIXTO: cobra solo el PENDIENTE (total − efectivo ya registrado)', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.CONFIRMADA,
      total: 50,
      cajeroId: 'caj-1',
      pagos: [{ monto: 30 }], // efectivo ya cobrado al crear la venta
    });

    await service.procesarPagoYape(RAW, FIRMA);

    expect(ventaService.procesarPago).toHaveBeenCalledWith(
      'venta-1',
      'emp-1',
      expect.objectContaining({ monto: 20 }), // 50 − 30 = porción Yape
      'caj-1',
      { skipCajaValidacion: true },
    );
  });

  it('mapea provider plin → método PLIN', async () => {
    conPayload(payloadPago({ payment: { provider: 'plin', id: 'p2' } }));
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.CONFIRMADA,
      total: 10,
      cajeroId: 'caj-1',
      pagos: [],
    });

    await service.procesarPagoYape(RAW, FIRMA);

    expect(ventaService.procesarPago).toHaveBeenCalledWith(
      'venta-1',
      'emp-1',
      expect.objectContaining({ metodoPago: MetodoPagoVenta.PLIN }),
      'caj-1',
      { skipCajaValidacion: true },
    );
  });

  it('idempotente: venta ya PAGADA_COMPLETA → no reprocesa', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.PAGADA_COMPLETA,
      total: 50,
      pagos: [{ monto: 50 }],
    });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(r).toMatchObject({ accion: 'ya-pagada' });
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
    expect(realtime.notifyVentaPagada).not.toHaveBeenCalled();
  });

  it('webhook tardío sobre venta ANULADA (expirada por TTL) → la ignora', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.ANULADA,
      total: 50,
      pagos: [],
    });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(r).toMatchObject({ accion: 'venta-anulada' });
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
  });

  it('sin saldo pendiente (pagos cubren el total) → no cobra de nuevo', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.CONFIRMADA,
      total: 50,
      pagos: [{ monto: 50 }],
    });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(r).toMatchObject({ accion: 'sin-saldo' });
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
  });

  it('cuenta no mapeada (verificarWebhook → null) → no toca nada', async () => {
    integracionYape.verificarWebhook.mockResolvedValue(null);
    const r = await service.procesarPagoYape(RAW, FIRMA);
    expect(r).toMatchObject({ accion: 'cuenta-no-mapeada' });
    expect(prisma.venta.findFirst).not.toHaveBeenCalled();
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
  });

  it('evento que no es payment.confirmed → ignorado', async () => {
    conPayload(payloadPago({ event: 'payment.created' }));
    const r = await service.procesarPagoYape(RAW, FIRMA);
    expect(r).toMatchObject({ accion: 'evento-ignorado' });
    expect(prisma.venta.findFirst).not.toHaveBeenCalled();
  });

  it('payload sin charge.reference → sin-referencia', async () => {
    conPayload(payloadPago({ charge: {} }));
    const r = await service.procesarPagoYape(RAW, FIRMA);
    expect(r).toMatchObject({ accion: 'sin-referencia' });
  });

  it('venta inexistente → venta-no-encontrada', async () => {
    conPayload(payloadPago());
    prisma.venta.findFirst.mockResolvedValue(null);
    const r = await service.procesarPagoYape(RAW, FIRMA);
    expect(r).toMatchObject({ accion: 'venta-no-encontrada' });
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
  });
});
