import { SyncrofactMapper } from './syncrofact.mapper';

/**
 * Regresión: una venta marcada "a crédito" pero pagada por adelantado en su
 * totalidad genera 0 cuotas. SUNAT/Syncrofact rechaza forma_pago=Credito sin
 * `forma_pago_cuotas` ("Debe especificar las cuotas de pago para operaciones a
 * crédito"). Reproducido en beta con VTA-SED-00000650 / B002-00000533.
 * Un crédito sin cuotas pendientes es CONTADO para SUNAT.
 */
describe('SyncrofactMapper.toInvoiceRequest — forma de pago crédito/contado', () => {
  const config: any = {
    porcentajeIGV: 18,
    entorno: 'beta',
    proveedorConfig: { companyId: 1, branchId: 1 },
  };

  const baseComprobante = (venta: any): any => ({
    id: 'comp-1',
    tipoComprobante: 'BOLETA',
    serie: 'B002',
    correlativo: '00000533',
    tipoDocumento: 'DNI',
    numeroDocumento: '12345678',
    nombreCliente: 'CLIENTE TEST',
    direccionCliente: null,
    emailCliente: null,
    fechaEmision: new Date('2026-06-29'),
    fechaVencimiento: null,
    moneda: 'PEN',
    tipoCambio: null,
    total: 50,
    detalles: [
      {
        descripcion: 'Producto',
        cantidad: 1,
        valorUnitario: 42.37,
        precioUnitario: 50,
        tipoAfectacion: '10',
        porcentajeIGV: 18,
        igv: 7.63,
        icbper: 0,
        unidadMedida: 'NIU',
      },
    ],
    venta,
  });

  it('crédito SIN cuotas (pagado por adelantado) → Contado, sin forma_pago_cuotas', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({ esCredito: true, cuotas: [], metodoPago: 'EFECTIVO' }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Contado');
    expect(body.forma_pago_cuotas).toBeUndefined();
  });

  it('crédito CON cuotas → Credito + forma_pago_cuotas que suman el total', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({
        esCredito: true,
        cuotas: [
          { numero: 1, monto: 25, fechaVencimiento: new Date('2026-07-29') },
          { numero: 2, monto: 25, fechaVencimiento: new Date('2026-08-29') },
        ],
      }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Credito');
    expect(body.forma_pago_cuotas).toHaveLength(2);
    const suma = body.forma_pago_cuotas!.reduce((s, c) => s + Number(c.monto), 0);
    expect(suma).toBe(50);
  });

  it('contado normal → Contado, sin forma_pago_cuotas', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({ esCredito: false, metodoPago: 'EFECTIVO' }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Contado');
    expect(body.forma_pago_cuotas).toBeUndefined();
  });

  // Ticket a crédito que se factura recién cuando el cliente termina de pagar
  // (pagos diarios/semanales): las cuotas EXISTEN pero ya no deben nada. Ir
  // como Credito emitiría fechas de pago pasadas y sin saldo que declarar.
  it('crédito con TODAS las cuotas cobradas → Contado (factura al terminar de pagar)', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({
        esCredito: true,
        metodoPago: 'EFECTIVO',
        cuotas: [
          { numero: 1, monto: 25, fechaVencimiento: new Date('2026-07-01'), saldoPendiente: 0 },
          { numero: 2, monto: 25, fechaVencimiento: new Date('2026-07-08'), saldoPendiente: 0 },
        ],
      }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Contado');
    expect(body.forma_pago_cuotas).toBeUndefined();
  });

  it('crédito con UNA cuota aún pendiente → Credito con TODAS las cuotas (suman el total)', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({
        esCredito: true,
        cuotas: [
          { numero: 1, monto: 25, fechaVencimiento: new Date('2026-07-01'), saldoPendiente: 0 },
          { numero: 2, monto: 25, fechaVencimiento: new Date('2026-07-08'), saldoPendiente: 25 },
        ],
      }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Credito');
    // El adelanto NO recorta el array: SUNAT exige que las cuotas sumen el total
    expect(body.forma_pago_cuotas).toHaveLength(2);
    const suma = body.forma_pago_cuotas!.reduce((s, c) => s + Number(c.monto), 0);
    expect(suma).toBe(50);
  });

  it('cuotas sin saldoPendiente (contrato legacy) → se asumen pendientes: Credito', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      baseComprobante({
        esCredito: true,
        cuotas: [{ numero: 1, monto: 50, fechaVencimiento: new Date('2026-08-29') }],
      }),
      config,
    );
    expect(body.forma_pago_tipo).toBe('Credito');
    expect(body.forma_pago_cuotas).toHaveLength(1);
  });

  // Pagos diarios: 30 cuotas viajan completas y deben sumar exactamente el
  // total (el resto del redondeo va en la última, igual que generarCuotas).
  it('30 cuotas diarias → las manda todas y suman exacto el total', () => {
    const cuotas = Array.from({ length: 30 }, (_, i) => ({
      numero: i + 1,
      monto: i === 29 ? 1.77 : 1.66,
      fechaVencimiento: new Date(2026, 6, i + 1),
      saldoPendiente: i === 29 ? 1.77 : 1.66,
    }));
    const body = SyncrofactMapper.toInvoiceRequest(
      { ...baseComprobante({ esCredito: true, cuotas }), total: 49.91 },
      config,
    );
    expect(body.forma_pago_tipo).toBe('Credito');
    expect(body.forma_pago_cuotas).toHaveLength(30);
    const suma = body.forma_pago_cuotas!.reduce((s, c) => s + Number(c.monto), 0);
    expect(Math.round(suma * 100) / 100).toBe(49.91);
  });
});

/**
 * Código de producto SUNAT (catálogos 25/25.1/25.2/25.3): passthrough opcional
 * al item. Desde 01.08.2026 un código inválido en el XML es RECHAZO (ERR-3496),
 * por eso solo viaja cuando es un código de 8 dígitos.
 */
describe('SyncrofactMapper.toInvoiceRequest — codigo_producto_sunat', () => {
  const config: any = {
    porcentajeIGV: 18,
    entorno: 'beta',
    proveedorConfig: { companyId: 1, branchId: 1 },
  };

  const comprobanteConProducto = (producto: any): any => ({
    id: 'comp-2',
    tipoComprobante: 'FACTURA',
    serie: 'F001',
    correlativo: '00000001',
    tipoDocumento: 'RUC',
    numeroDocumento: '10466735600',
    nombreCliente: 'GRAOS RAMIREZ NOE CONCEPCION',
    direccionCliente: null,
    emailCliente: null,
    fechaEmision: new Date('2026-07-11'),
    fechaVencimiento: null,
    moneda: 'PEN',
    tipoCambio: null,
    total: 826,
    detalles: [
      {
        descripcion: 'POLLO BENEFICIADO (kg)',
        cantidad: 100,
        valorUnitario: 7,
        precioUnitario: 8.26,
        tipoAfectacion: '10',
        porcentajeIGV: 18,
        igv: 126,
        icbper: 0,
        unidadMedida: 'KGM',
        producto,
      },
    ],
    venta: null,
  });

  it('producto CON código → item lleva codigo_producto_sunat', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConProducto({ codigoEmpresa: 'PBEN', codigoProductoSunat: '50111500' }),
      config,
    );
    expect(body.detalles[0].codigo_producto_sunat).toBe('50111500');
  });

  it('producto SIN código → item NO lleva codigo_producto_sunat', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConProducto({ codigoEmpresa: 'PBEN', codigoProductoSunat: null }),
      config,
    );
    expect(body.detalles[0]).not.toHaveProperty('codigo_producto_sunat');
  });

  it('código con formato inválido → se omite (no arriesgar ERR-3496)', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConProducto({ codigoEmpresa: 'PBEN', codigoProductoSunat: 'ABC123' }),
      config,
    );
    expect(body.detalles[0]).not.toHaveProperty('codigo_producto_sunat');
  });

  it('detalle de servicio (sin producto) → item NO lleva codigo_producto_sunat', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConProducto(null),
      config,
    );
    expect(body.detalles[0]).not.toHaveProperty('codigo_producto_sunat');
  });
});

/**
 * Operaciones GRATUITAS (regalos/bonificaciones, guard SUNAT 3105): la línea
 * convertida (afectación 15/21/31) viaja con mto_valor_unitario 0 y el valor
 * de lista como mto_valor_gratuito. Solo las gravadas (11-16) llevan % IGV
 * informativo.
 */
describe('SyncrofactMapper.toInvoiceRequest — líneas gratuitas', () => {
  const config: any = {
    porcentajeIGV: 18,
    entorno: 'beta',
    proveedorConfig: { companyId: 1, branchId: 1 },
  };

  const comprobanteConLinea = (detalle: any): any => ({
    id: 'comp-3',
    tipoComprobante: 'BOLETA',
    serie: 'B002',
    correlativo: '00000100',
    tipoDocumento: 'DNI',
    numeroDocumento: '12345678',
    nombreCliente: 'CLIENTE',
    direccionCliente: null,
    emailCliente: null,
    fechaEmision: new Date('2026-07-11'),
    fechaVencimiento: null,
    moneda: 'PEN',
    tipoCambio: null,
    total: 0,
    detalles: [detalle],
    venta: null,
  });

  const lineaBase = {
    descripcion: 'BOLSA BLANDA (regalo)',
    cantidad: 1,
    precioUnitario: 0,
    porcentajeIGV: 18,
    igv: 0,
    icbper: 0,
    unidadMedida: 'NIU',
    producto: { codigoEmpresa: 'BOLSA' },
  };

  it('gratuita GRAVADA (15) → valor_unitario 0 + valor_gratuito referencial + IGV informativo', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConLinea({ ...lineaBase, tipoAfectacion: '15', valorUnitario: 4.24 }),
      config,
    );
    const item = body.detalles[0];
    expect(item.tip_afe_igv).toBe('15');
    expect(item.mto_valor_unitario).toBe(0);
    expect(item.mto_valor_gratuito).toBe(4.24);
    expect(item.porcentaje_igv).toBe(18);
    expect(item).not.toHaveProperty('mto_precio_unitario');
  });

  it('gratuita INAFECTA (31) → sin IGV informativo', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConLinea({ ...lineaBase, tipoAfectacion: '31', valorUnitario: 5 }),
      config,
    );
    const item = body.detalles[0];
    expect(item.mto_valor_gratuito).toBe(5);
    expect(item.porcentaje_igv).toBe(0);
  });

  it('gratuita EXONERADA (21) → sin IGV informativo', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConLinea({ ...lineaBase, tipoAfectacion: '21', valorUnitario: 3 }),
      config,
    );
    const item = body.detalles[0];
    expect(item.mto_valor_gratuito).toBe(3);
    expect(item.porcentaje_igv).toBe(0);
  });

  it('línea onerosa normal NO lleva mto_valor_gratuito', () => {
    const body = SyncrofactMapper.toInvoiceRequest(
      comprobanteConLinea({
        ...lineaBase,
        tipoAfectacion: '10',
        precioUnitario: 11.8,
        valorUnitario: 10,
      }),
      config,
    );
    expect(body.detalles[0]).not.toHaveProperty('mto_valor_gratuito');
    expect(body.detalles[0].mto_precio_unitario).toBe(11.8);
  });
});
