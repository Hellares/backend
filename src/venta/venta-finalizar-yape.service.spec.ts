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

    service = new VentaService(
      prisma, null as any, null as any, cajaService, null as any,
      facturacionService, null as any, null as any, null as any,
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

  it('venta NORMAL (sin intención diferida): NO emite comprobante en procesarPago', async () => {
    tx.venta.findFirst.mockResolvedValue(
      ventaDiferida({ tipoComprobanteDiferido: null }),
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
});
