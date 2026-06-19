import { VentaService } from './venta.service';

/**
 * Tests del cálculo del PENDIENTE en `cobroYape` — el lado SALIENTE del cobro:
 * cuánto se le pide validar a api-yape. Invariante clave del pago MIXTO:
 *   monto a validar = total − pagos ya registrados (NO el total).
 *
 * `cobroYape` solo referencia `this.prisma` y `this.integracionYape` (y la
 * función de módulo `round2`), así que lo invocamos sobre un `this` falso sin
 * instanciar el servicio (que tiene muchas dependencias).
 */
describe('VentaService.cobroYape (pendiente / mixto)', () => {
  const cobroYape: (empresaId: string, ventaId: string) => Promise<any> = (
    VentaService.prototype as any
  ).cobroYape;

  const armarThis = (venta: any, cobro: any, qr: any = { qrYapeUrl: 'u-yape', qrPlinUrl: null }, yapeHabilitado = true) => ({
    prisma: {
      venta: { findFirst: jest.fn().mockResolvedValue(venta) },
      configuracionEmpresa: { findUnique: jest.fn().mockResolvedValue(qr) },
    },
    integracionYape: { crearCobro: jest.fn().mockResolvedValue(cobro) },
    caracteristicaEmpresa: { estaHabilitada: jest.fn().mockResolvedValue(yapeHabilitado) },
  });

  it('100% Yape (sin pagos): pide validar el TOTAL y devuelve habilitado + QR', async () => {
    const ctx = armarThis(
      { id: 'v1', total: 50, sedeId: 's1', estado: 'CONFIRMADA', pagos: [] },
      { payAmount: 50, chargeId: 'c1' },
    );
    const r = await cobroYape.call(ctx, 'emp-1', 'v1');

    expect(ctx.integracionYape.crearCobro).toHaveBeenCalledWith(
      expect.objectContaining({ empresaId: 'emp-1', ventaId: 'v1', monto: 50 }),
    );
    expect(r).toMatchObject({
      habilitado: true,
      payAmount: 50,
      chargeId: 'c1',
      qrYapeUrl: 'u-yape',
      qrPlinUrl: null,
    });
  });

  it('MIXTO (efectivo ya registrado): pide validar solo el PENDIENTE', async () => {
    const ctx = armarThis(
      { id: 'v1', total: 50, sedeId: 's1', estado: 'CONFIRMADA', pagos: [{ monto: 30 }] },
      { payAmount: 20, chargeId: 'c1' },
    );
    await cobroYape.call(ctx, 'emp-1', 'v1');

    expect(ctx.integracionYape.crearCobro).toHaveBeenCalledWith(
      expect.objectContaining({ monto: 20 }), // 50 − 30
    );
  });

  it('pendiente <= 0 (pagos cubren el total): NO llama a api-yape, habilitado:false + QR', async () => {
    const ctx = armarThis(
      { id: 'v1', total: 50, sedeId: 's1', estado: 'CONFIRMADA', pagos: [{ monto: 50 }] },
      null,
    );
    const r = await cobroYape.call(ctx, 'emp-1', 'v1');

    expect(ctx.integracionYape.crearCobro).not.toHaveBeenCalled();
    expect(r).toMatchObject({ habilitado: false, qrYapeUrl: 'u-yape' });
  });

  it('api-yape no responde (crearCobro → null): habilitado:false pero igual devuelve el QR', async () => {
    const ctx = armarThis(
      { id: 'v1', total: 50, sedeId: 's1', estado: 'CONFIRMADA', pagos: [] },
      null,
    );
    const r = await cobroYape.call(ctx, 'emp-1', 'v1');

    expect(ctx.integracionYape.crearCobro).toHaveBeenCalled();
    expect(r).toMatchObject({ habilitado: false, qrYapeUrl: 'u-yape', qrPlinUrl: null });
  });

  it('GATE PREMIUM: empresa SIN YAPE_QR habilitado → habilitado:false, SIN QR, no llama api-yape', async () => {
    const ctx = armarThis(
      { id: 'v1', total: 50, sedeId: 's1', estado: 'CONFIRMADA', pagos: [] },
      { payAmount: 50, chargeId: 'c1' },
      { qrYapeUrl: 'u-yape', qrPlinUrl: 'u-plin' },
      false, // YAPE_QR NO habilitado
    );
    const r = await cobroYape.call(ctx, 'emp-1', 'v1');

    expect(ctx.caracteristicaEmpresa.estaHabilitada).toHaveBeenCalledWith('emp-1', 'YAPE_QR');
    expect(ctx.integracionYape.crearCobro).not.toHaveBeenCalled();
    expect(r).toEqual({ habilitado: false, qrYapeUrl: null, qrPlinUrl: null });
  });
});
