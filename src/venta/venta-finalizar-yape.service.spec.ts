import { EstadoVenta } from '@prisma/client';
import { VentaService } from './venta.service';

/**
 * Tests del COMPROBANTE DIFERIDO en `procesarPago`: cuando una venta Yape nació
 * CONFIRMADA sin comprobante (intención en *Diferido), el comprobante se emite
 * recién al quedar PAGADA_COMPLETA (al confirmarse el pago, webhook o manual).
 *
 * Clave: en ventas NORMALES (tipoComprobanteDiferido = null) NO se dispara.
 */
describe('VentaService.procesarPago — comprobante diferido (Yape)', () => {
  let service: VentaService;
  let prisma: any;
  let tx: any;
  let cajaService: any;
  let facturacionService: any;
  let integracionYape: any;
  let ordenServicioService: any;
  let emitirSpy: jest.SpyInstance;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  const ventaDiferida = (over: any = {}) => ({
    id: 'venta-1',
    codigo: 'VTA-SED-00000001',
    estado: EstadoVenta.CONFIRMADA,
    total: 50,
    totalConInteres: null,
    moneda: 'PEN',
    sedeId: 'sede-1',
    canalVenta: 'POS',
    cajeroId: 'caj-1',
    documentoCliente: '00000000',
    clienteId: null,
    clienteEmpresaId: null,
    nombreCliente: 'CLIENTES VARIOS',
    direccionCliente: null,
    emailCliente: null,
    cobroDiferido: true,
    tipoComprobanteDiferido: 'BOLETA',
    sedeFacturacionIdDiferido: null,
    tipoDocumentoClienteDiferido: null,
    pagos: [],
    detalles: [
      {
        descripcion: 'Producto X', cantidad: 1, tipoAfectacion: '10',
        porcentajeIGV: 18, subtotal: 42.37, igv: 7.63, total: 50, icbper: 0,
        productoId: 'prod-1',
      },
    ],
    ...over,
  });

  beforeEach(() => {
    tx = {
      venta: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'venta-1', estado: data.estado }),
        ),
      },
      pagoVenta: {
        create: jest.fn().mockResolvedValue({
          id: 'pago-1', monto: 50, metodoPago: 'YAPE', referencia: 'OP-1',
        }),
        update: jest.fn(),
      },
      cuotaVenta: { findMany: jest.fn().mockResolvedValue([]) },
      comprobanteElectronico: { findFirst: jest.fn().mockResolvedValue(null) },
      caja: { findFirst: jest.fn().mockResolvedValue({ id: 'caja-1' }) },
      configuracionEmpresa: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
    cajaService = { registrarMovimientoSiHayCaja: jest.fn().mockResolvedValue(undefined) };
    facturacionService = { enviarComprobante: jest.fn().mockResolvedValue(undefined) };
    integracionYape = { cancelarCobro: jest.fn().mockResolvedValue(0) };
    ordenServicioService = {
      marcarOrdenesCobradasPorVenta: jest.fn().mockResolvedValue([{ id: 'os-1', codigo: 'ORD-1' }]),
      procesarPostCobroOrdenes: jest.fn().mockResolvedValue(undefined),
    };

    service = new VentaService(
      prisma, null as any, null as any, cajaService, null as any,
      facturacionService, ordenServicioService, null as any, null as any,
      integracionYape, logger as any,
    );

    // _emitirComprobante ya está testeado aparte: aquí lo espiamos.
    emitirSpy = jest
      .spyOn(service as any, '_emitirComprobante')
      .mockResolvedValue({ comprobanteId: 'comp-1', codigoGenerado: 'B001-00000006' });
  });

  const dtoYape = { metodoPago: 'YAPE', monto: 50, referencia: 'OP-1' } as any;

  it('venta diferida pagada por webhook: emite comprobante y lo envía a Nubefact', async () => {
    tx.venta.findFirst.mockResolvedValue(ventaDiferida());

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    expect(emitirSpy).toHaveBeenCalledTimes(1);
    expect(emitirSpy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        ventaId: 'venta-1',
        tipoComprobante: 'BOLETA',
        pagos: [expect.objectContaining({ metodoPago: 'YAPE', monto: 50 })],
      }),
    );
    // Envío a Nubefact tras commit
    expect(facturacionService.enviarComprobante).toHaveBeenCalledWith('comp-1', 'emp-1');
  });

  it('venta NORMAL (no diferida): NO emite comprobante en procesarPago', async () => {
    tx.venta.findFirst.mockResolvedValue(
      ventaDiferida({ cobroDiferido: false, tipoComprobanteDiferido: null }),
    );

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    expect(emitirSpy).not.toHaveBeenCalled();
    expect(facturacionService.enviarComprobante).not.toHaveBeenCalled();
  });

  it('idempotente: si ya existe comprobante, no re-emite', async () => {
    tx.venta.findFirst.mockResolvedValue(ventaDiferida());
    tx.comprobanteElectronico.findFirst.mockResolvedValue({ id: 'comp-existente' });

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    expect(emitirSpy).not.toHaveBeenCalled();
  });

  it('pago parcial (no completa el total): no emite todavía', async () => {
    tx.venta.findFirst.mockResolvedValue(ventaDiferida({ total: 100 }));

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    expect(emitirSpy).not.toHaveBeenCalled();
  });

  it('FACTURA diferida: emite con tipoComprobante=FACTURA y datos de cliente RUC', async () => {
    tx.venta.findFirst.mockResolvedValue(
      ventaDiferida({
        tipoComprobanteDiferido: 'FACTURA',
        documentoCliente: '20614166674',
        tipoDocumentoClienteDiferido: '6',
        nombreCliente: 'ACME SAC',
      }),
    );

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    expect(emitirSpy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tipoComprobante: 'FACTURA',
        cliente: expect.objectContaining({
          documentoCliente: '20614166674',
          tipoDocumentoCliente: '6',
        }),
      }),
    );
    expect(facturacionService.enviarComprobante).toHaveBeenCalledWith('comp-1', 'emp-1');
  });

  it('PLIN diferido: el comprobante refleja el pago PLIN', async () => {
    tx.venta.findFirst.mockResolvedValue(ventaDiferida());
    tx.pagoVenta.create.mockResolvedValue({
      id: 'pago-1', monto: 50, metodoPago: 'PLIN', referencia: 'OP-9',
    });

    await service.procesarPago(
      'venta-1', 'emp-1',
      { metodoPago: 'PLIN', monto: 50, referencia: 'OP-9' } as any,
      'caj-1', { skipCajaValidacion: true },
    );

    expect(emitirSpy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        pagos: [expect.objectContaining({ metodoPago: 'PLIN', monto: 50 })],
      }),
    );
  });

  it('ORDEN diferida: al pagar marca la orden FINALIZADA y emite comprobante con su adelanto', async () => {
    // Venta diferida cuyo detalle es una orden de servicio (sin productoId).
    tx.venta.findFirst.mockResolvedValue(
      ventaDiferida({
        detalles: [{
          descripcion: 'Servicio X', cantidad: 1, tipoAfectacion: '10',
          porcentajeIGV: 18, subtotal: 42.37, igv: 7.63, total: 50, icbper: 0,
          productoId: null, ordenServicioId: 'os-1',
        }],
      }),
    );
    // La orden con su adelanto (se carga al pagar).
    tx.ordenServicio = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'os-1', codigo: 'ORD-1', estado: 'LISTO_ENTREGA', estadoDiagnostico: null, adelanto: 20, metodoPagoAdelanto: 'EFECTIVO' },
      ]),
    };

    await service.procesarPago('venta-1', 'emp-1', dtoYape, 'caj-1', {
      skipCajaValidacion: true,
    });

    // El comprobante incluye el adelanto de la orden en el desglose.
    expect(emitirSpy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        ordenesACobrar: [expect.objectContaining({ codigo: 'ORD-1', adelanto: 20 })],
      }),
    );
    // La orden se marca FINALIZADA recién al pagar (no al crear).
    expect(ordenServicioService.marcarOrdenesCobradasPorVenta).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        ordenes: [expect.objectContaining({ id: 'os-1' })],
        comprobante: expect.objectContaining({ id: 'comp-1' }),
      }),
    );
    // Post-commit: notifica al cliente (servicio finalizado).
    expect(ordenServicioService.procesarPostCobroOrdenes).toHaveBeenCalled();
  });
});
