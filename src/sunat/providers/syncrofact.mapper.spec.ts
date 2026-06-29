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
});
