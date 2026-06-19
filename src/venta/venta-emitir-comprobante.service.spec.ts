import { VentaService } from './venta.service';

/**
 * Tests del helper `_emitirComprobante` — extraído de `crearYCobrar` para poder
 * emitir el comprobante EN EL MOMENTO DEL PAGO (flujo Yape diferido). Cubre las
 * rutas críticas: correlativo BOLETA/FACTURA, codigoGenerado, PagoComprobante
 * por pago, sede sin serie, y validación de documento.
 *
 * Sin DB: mockeamos el cliente de transacción `tx`. `calcularTotalesTributarios`
 * es real (método puro de la clase). El resto de deps del constructor van null
 * porque el helper solo usa `this.calcularTotalesTributarios` y `this.logger`.
 */
describe('VentaService._emitirComprobante', () => {
  let service: VentaService;
  let tx: any;

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  };

  const detalle = (over: any = {}) => ({
    descripcion: 'Producto X',
    cantidad: 1,
    tipoAfectacion: 'GRAVADO',
    porcentajeIGV: 18,
    subtotal: 42.37,
    igv: 7.63,
    total: 50,
    icbper: 0,
    productoId: 'prod-1',
    ...over,
  });

  const params = (over: any = {}) => ({
    empresaId: 'emp-1',
    ventaId: 'venta-1',
    ventaCodigo: 'VTA-SED-00000001',
    tipoComprobante: 'BOLETA',
    detallesCalculados: [detalle()],
    cliente: { documentoCliente: '00000000', nombreCliente: 'CLIENTES VARIOS' },
    sedeId: 'sede-1',
    moneda: 'PEN',
    pagos: [{ metodoPago: 'YAPE', monto: 50, referencia: 'OP-1' }],
    metodoPagoFallback: 'YAPE',
    ordenesACobrar: [],
    esCredito: false,
    totalVenta: 50,
    totalACobrarHoy: 50,
    montoRecibido: 50,
    ...over,
  });

  beforeEach(() => {
    service = new VentaService(
      null as any, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
      logger as any, null as any,
    );
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'sede-1',
          serieFactura: 'F001',
          serieBoleta: 'B001',
          ultimoNumeroFactura: 10,
          ultimoNumeroBoleta: 25,
        },
      ]),
      sede: { update: jest.fn().mockResolvedValue({ ultimoNumeroBoleta: 26 }) },
      comprobanteElectronico: {
        create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
      },
      pagoComprobante: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('BOLETA: incrementa el correlativo de boleta y arma codigoGenerado', async () => {
    const r = await (service as any)._emitirComprobante(tx, params());

    expect(tx.sede.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ultimoNumeroBoleta: { increment: 1 } } }),
    );
    expect(r).toEqual({ comprobanteId: 'comp-1', codigoGenerado: 'B001-00000026' });
    expect(tx.comprobanteElectronico.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serie: 'B001',
          correlativo: '00000026',
          tipoComprobante: 'BOLETA',
          ventaId: 'venta-1',
        }),
      }),
    );
  });

  it('FACTURA: usa serie y contador de factura', async () => {
    tx.sede.update.mockResolvedValue({ ultimoNumeroFactura: 11 });
    const r = await (service as any)._emitirComprobante(
      tx,
      params({
        tipoComprobante: 'FACTURA',
        cliente: {
          documentoCliente: '20614166674',
          tipoDocumentoCliente: '6',
          nombreCliente: 'ACME SAC',
        },
      }),
    );

    expect(tx.sede.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ultimoNumeroFactura: { increment: 1 } } }),
    );
    expect(r?.codigoGenerado).toBe('F001-00000011');
  });

  it('registra un PagoComprobante COMPLETADO por cada pago (Yape diferido)', async () => {
    await (service as any)._emitirComprobante(
      tx,
      params({ pagos: [{ metodoPago: 'YAPE', monto: 50, referencia: 'OP-1' }] }),
    );
    const arg = tx.pagoComprobante.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      expect.objectContaining({ metodoPago: 'YAPE', estado: 'COMPLETADO' }),
    ]);
  });

  it('sede sin serie configurada → devuelve null y NO crea comprobante', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const r = await (service as any)._emitirComprobante(tx, params());
    expect(r).toBeNull();
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
  });

  it('FACTURA con RUC inválido → lanza error (no emite)', async () => {
    await expect(
      (service as any)._emitirComprobante(
        tx,
        params({ tipoComprobante: 'FACTURA', cliente: { documentoCliente: '123' } }),
      ),
    ).rejects.toThrow();
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
  });
});
