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
      // La unidad en la que se declara cada línea sale del producto: sin
      // presentación configurada, la línea se emite tal cual está guardada.
      producto: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            factorPresentacion: null,
            unidadPresentacion: null,
            unidadMedida: { unidadMaestra: { codigo: 'NIU' } },
          },
        ]),
      },
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

  it('declara la línea en la unidad de PRESENTACIÓN, no en la de venta', async () => {
    // RICOCAN: se guarda en gramos, se cobra en kilos. La venta lleva 1500 g
    // a S/0.008 el gramo; el comprobante tiene que decir 1.5 KGM a S/8.00.
    tx.producto.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        factorPresentacion: 1000,
        unidadPresentacion: {
          simboloLocal: null,
          simboloPersonalizado: null,
          unidadMaestra: { codigo: 'KGM', simbolo: 'kg' },
        },
        unidadMedida: { unidadMaestra: { codigo: 'GRM' } },
      },
    ]);

    await (service as any)._emitirComprobante(
      tx,
      params({
        detallesCalculados: [
          detalle({ cantidad: 1500, subtotal: 10.17, igv: 1.83, total: 12 }),
        ],
        totalVenta: 12,
      }),
    );

    const linea =
      tx.comprobanteElectronico.create.mock.calls[0][0].data.detalles.create[0];

    expect(Number(linea.cantidad)).toBe(1.5);
    expect(linea.unidadMedida).toBe('KGM');
    expect(Number(linea.precioUnitario)).toBeCloseTo(8, 4);
    // El monto de la línea NO se toca: es lo que pagó el cliente.
    expect(Number(linea.total)).toBe(12);
    expect(Number(linea.cantidad) * Number(linea.precioUnitario)).toBeCloseTo(12, 2);
  });

  it('sin presentación declara la unidad del producto, ya no NIU fijo', async () => {
    tx.producto.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        factorPresentacion: null,
        unidadPresentacion: null,
        unidadMedida: { unidadMaestra: { codigo: 'KGM' } },
      },
    ]);

    await (service as any)._emitirComprobante(tx, params());

    const linea =
      tx.comprobanteElectronico.create.mock.calls[0][0].data.detalles.create[0];
    expect(linea.unidadMedida).toBe('KGM');
    expect(Number(linea.cantidad)).toBe(1);
  });

  it('unidad PERSONALIZADA cae a NIU (su código no existe en el catálogo 03)', async () => {
    tx.producto.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        factorPresentacion: 100,
        unidadPresentacion: {
          simboloLocal: '100 g',
          simboloPersonalizado: '100g',
          unidadMaestra: null,
        },
        unidadMedida: { unidadMaestra: null },
      },
    ]);

    await (service as any)._emitirComprobante(
      tx,
      params({
        detallesCalculados: [
          detalle({ cantidad: 200, subtotal: 10.17, igv: 1.83, total: 12 }),
        ],
        totalVenta: 12,
      }),
    );

    const linea =
      tx.comprobanteElectronico.create.mock.calls[0][0].data.detalles.create[0];
    // La cantidad SÍ se convierte (2 presentaciones de 100 g); lo que no se
    // manda es el código inventado.
    expect(Number(linea.cantidad)).toBe(2);
    expect(linea.unidadMedida).toBe('NIU');
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
