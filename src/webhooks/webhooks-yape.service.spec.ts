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
  let pedidoEmpresa: any;
  let cotizacionService: any;
  let sorteosService: any;
  let whatsapp: any;
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
    prisma = {
      venta: { findFirst: jest.fn() },
      conversacionWhatsapp: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    ventaService = {
      procesarPago: jest.fn().mockResolvedValue({ estado: EstadoVenta.PAGADA_COMPLETA }),
    };
    realtime = { notifyVentaPagada: jest.fn() };
    pedidoEmpresa = {
      confirmarPagoYapeAutomatico: jest
        .fn()
        .mockResolvedValue({ accion: 'pago-validado', pedidoId: 'ped-1' }),
    };
    cotizacionService = {
      confirmarAdelantoYapeAutomatico: jest
        .fn()
        .mockResolvedValue({ accion: 'adelanto-registrado', cotizacionId: 'cot-1' }),
    };
    sorteosService = {
      autoValidarPorPagoYape: jest
        .fn()
        .mockResolvedValue({ accion: 'sin-pendientes' }),
    };
    whatsapp = { enviarTexto: jest.fn().mockResolvedValue(true) };
    service = new WebhooksService(
      prisma,
      logger as any,
      integracionYape,
      ventaService,
      realtime,
      pedidoEmpresa,
      cotizacionService,
      sorteosService,
      whatsapp,
    );
  });

  it('reference con prefijo cotizacion: → registra el adelanto de separación (no toca ventas)', async () => {
    conPayload(
      payloadPago({ charge: { reference: 'cotizacion:cot-1', baseAmount: 50 } }),
    );

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(cotizacionService.confirmarAdelantoYapeAutomatico).toHaveBeenCalledWith(
      'emp-1',
      'cot-1',
      { monto: 50, metodo: 'YAPE', referencia: 'OP-123' },
    );
    expect(r).toMatchObject({ ok: true, accion: 'adelanto-registrado' });
    expect(prisma.venta.findFirst).not.toHaveBeenCalled();
  });

  it('reference con prefijo pedido: → rutea al pedido marketplace (no toca ventas)', async () => {
    conPayload(payloadPago({ charge: { reference: 'pedido:ped-1' } }));

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(pedidoEmpresa.confirmarPagoYapeAutomatico).toHaveBeenCalledWith(
      'emp-1',
      'ped-1',
      { metodo: 'YAPE', referencia: 'OP-123' },
    );
    expect(r).toMatchObject({ ok: true, accion: 'pago-validado', pedidoId: 'ped-1' });
    expect(prisma.venta.findFirst).not.toHaveBeenCalled();
    expect(ventaService.procesarPago).not.toHaveBeenCalled();
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

  it('SPLIT: registra el baseAmount del CHARGE (tramo), no el pendiente completo', async () => {
    // Venta de 1500 cobrada en tramos de 500; llega el webhook de UN tramo.
    conPayload(payloadPago({ charge: { reference: 'venta-1', baseAmount: 500 } }));
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.CONFIRMADA,
      total: 1500,
      cajeroId: 'caj-1',
      pagos: [], // pendiente = 1500
    });
    // Aún no completa (1er tramo) → PAGADA_PARCIAL
    ventaService.procesarPago.mockResolvedValue({ estado: EstadoVenta.PAGADA_PARCIAL });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    // Registra 500 (el tramo), NO 1500 (el pendiente)
    expect(ventaService.procesarPago).toHaveBeenCalledWith(
      'venta-1', 'emp-1',
      expect.objectContaining({ monto: 500 }),
      'caj-1', { skipCajaValidacion: true },
    );
    // Tramo intermedio → NO cierra la hoja, accion pago-parcial
    expect(r).toMatchObject({ accion: 'pago-parcial' });
    expect(realtime.notifyVentaPagada).not.toHaveBeenCalled();
  });

  it('SPLIT: el último tramo completa → notifica pagada', async () => {
    conPayload(payloadPago({ charge: { reference: 'venta-1', baseAmount: 500 } }));
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-1',
      estado: EstadoVenta.PAGADA_PARCIAL,
      total: 1500,
      cajeroId: 'caj-1',
      pagos: [{ monto: 500 }, { monto: 500 }], // ya 1000, este tramo completa
    });
    ventaService.procesarPago.mockResolvedValue({ estado: EstadoVenta.PAGADA_COMPLETA });

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(ventaService.procesarPago).toHaveBeenCalledWith(
      'venta-1', 'emp-1',
      expect.objectContaining({ monto: 500 }), // min(500, pendiente 500)
      'caj-1', { skipCajaValidacion: true },
    );
    expect(r).toMatchObject({ accion: 'pagada' });
    expect(realtime.notifyVentaPagada).toHaveBeenCalledWith({ empresaId: 'emp-1', ventaId: 'venta-1' });
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

  it('evento payment.received → auto-validación de participaciones de sorteo', async () => {
    conPayload(
      payloadPago({
        event: 'payment.received',
        charge: null,
        payment: {
          provider: 'yape',
          senderName: 'Rosa T.',
          amount: 20,
          receivedAt: '2026-07-18T20:00:00.000Z',
        },
      }),
    );

    const r = await service.procesarPagoYape(RAW, FIRMA);

    expect(sorteosService.autoValidarPorPagoYape).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ senderName: 'Rosa T.', amount: 20 }),
    );
    expect(r).toMatchObject({ ok: true, accion: 'sin-pendientes' });
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
