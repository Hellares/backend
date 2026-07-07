import {
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
} from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * Tests del registro en caja de adelantos de órdenes de servicio.
 *
 * El helper es delta-based: registra solo la DIFERENCIA entre el adelanto
 * anterior y el nuevo, respetando el medio de pago del abono (cada abono
 * parcial queda con SU método aunque la orden guarde solo el último).
 *
 * Invariantes:
 * - delta > 0 → INGRESO ADELANTO_SERVICIO por el delta.
 * - delta < 0 → EGRESO ADELANTO_SERVICIO (corrección) por |delta|.
 * - |delta| < 0.01 → no toca caja NI crea fila del libro.
 * - método inválido/ausente → fallback EFECTIVO.
 * - usa registrarMovimientoEnCajaOTesoreria (sin caja abierta cae a Caja
 *   Central — el dinero nunca se pierde).
 * - TODO delta crea una fila en el LIBRO AdelantoOrdenServicio (con fecha/
 *   hora/método/usuario); `sinFila: true` (anulaciones) la omite porque el
 *   flag `anulado` de la fila original ya la excluye de la suma.
 */

const registrar = (OrdenServicioService.prototype as any)[
  'registrarDeltaAdelantoEnCaja'
];

const makeSelf = () => ({
  cajaService: {
    registrarMovimientoEnCajaOTesoreria: jest.fn().mockResolvedValue({}),
  },
});

const baseParams = (overrides: Partial<any> = {}) => ({
  empresaId: 'empresa-1',
  ordenId: 'orden-1',
  codigo: 'OS-00000006',
  sedeId: 'sede-1',
  usuarioId: 'user-1',
  adelantoAnterior: 0,
  adelantoNuevo: 50,
  metodoPago: 'YAPE',
  ...overrides,
});

const makeTx = (
  cajaUsuario: { sedeId: string } | null = null,
  sedePrincipal: { id: string } | null = null,
) =>
  ({
    caja: { findFirst: jest.fn().mockResolvedValue(cajaUsuario) },
    sede: { findFirst: jest.fn().mockResolvedValue(sedePrincipal) },
    // Libro de adelantos: snapshot de usuario (best-effort) + fila por delta.
    usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    adelantoOrdenServicio: { create: jest.fn().mockResolvedValue({}) },
  }) as any;

const TX = makeTx();

describe('OrdenServicioService.registrarDeltaAdelantoEnCaja', () => {
  it('primer abono → INGRESO ADELANTO_SERVICIO con su método (YAPE)', async () => {
    const self = makeSelf();
    await registrar.call(self, TX, baseParams());

    expect(self.cajaService.registrarMovimientoEnCajaOTesoreria)
      .toHaveBeenCalledWith(
        'empresa-1',
        'sede-1',
        'user-1',
        expect.objectContaining({
          tipo: TipoMovimientoCaja.INGRESO,
          categoria: CategoriaMovimientoCaja.ADELANTO_SERVICIO,
          metodoPago: MetodoPagoVenta.YAPE,
          monto: 50,
          ordenServicioId: 'orden-1',
          descripcion: expect.stringContaining('OS-00000006'),
        }),
        TX,
      );
  });

  it('ampliación 50→80 → INGRESO solo por el delta (30) con el método nuevo', async () => {
    const self = makeSelf();
    await registrar.call(
      self,
      TX,
      baseParams({ adelantoAnterior: 50, adelantoNuevo: 80, metodoPago: 'EFECTIVO' }),
    );

    const call =
      self.cajaService.registrarMovimientoEnCajaOTesoreria.mock.calls[0];
    expect(call[3].tipo).toBe(TipoMovimientoCaja.INGRESO);
    expect(call[3].monto).toBe(30);
    expect(call[3].metodoPago).toBe(MetodoPagoVenta.EFECTIVO);
  });

  it('corrección 80→50 → EGRESO por |delta| (30)', async () => {
    const self = makeSelf();
    await registrar.call(
      self,
      TX,
      baseParams({ adelantoAnterior: 80, adelantoNuevo: 50 }),
    );

    const call =
      self.cajaService.registrarMovimientoEnCajaOTesoreria.mock.calls[0];
    expect(call[3].tipo).toBe(TipoMovimientoCaja.EGRESO);
    expect(call[3].monto).toBe(30);
    expect(call[3].descripcion).toContain('Corrección');
  });

  it('sin cambio (delta < 1 centavo) → no toca caja', async () => {
    const self = makeSelf();
    await registrar.call(
      self,
      TX,
      baseParams({ adelantoAnterior: 50, adelantoNuevo: 50.004 }),
    );
    expect(self.cajaService.registrarMovimientoEnCajaOTesoreria)
      .not.toHaveBeenCalled();
  });

  it('orden sin sedeId → fallback a la sede de la caja abierta del usuario', async () => {
    const self = makeSelf();
    const tx = makeTx({ sedeId: 'sede-de-caja' });
    await registrar.call(self, tx, baseParams({ sedeId: null }));

    expect(tx.caja.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuarioId: 'user-1',
          estado: 'ABIERTA',
          esCajaCentral: false,
        }),
      }),
    );
    const call =
      self.cajaService.registrarMovimientoEnCajaOTesoreria.mock.calls[0];
    expect(call[1]).toBe('sede-de-caja'); // sedeId resuelto desde la caja
  });

  it('sin sedeId NI caja abierta → fallback a la sede principal de la empresa', async () => {
    const self = makeSelf();
    const tx = makeTx(null, { id: 'sede-principal' });
    await registrar.call(self, tx, baseParams({ sedeId: null }));

    expect(tx.sede.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          empresaId: 'empresa-1',
          isActive: true,
          deletedAt: null,
        }),
        orderBy: { creadoEn: 'asc' },
      }),
    );
    const call =
      self.cajaService.registrarMovimientoEnCajaOTesoreria.mock.calls[0];
    expect(call[1]).toBe('sede-principal'); // Caja Central de esa sede absorbe
  });

  it('empresa sin sedes activas → no toca caja (warn, no rompe)', async () => {
    const self = makeSelf();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await registrar.call(
      self,
      makeTx(null, null),
      baseParams({ sedeId: null }),
    );
    expect(self.cajaService.registrarMovimientoEnCajaOTesoreria)
      .not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    ['PLIN', MetodoPagoVenta.PLIN],
    ['TARJETA', MetodoPagoVenta.TARJETA],
    ['TRANSFERENCIA', MetodoPagoVenta.TRANSFERENCIA],
    ['yape', MetodoPagoVenta.YAPE], // case-insensitive
    ['CHEQUE_MAGICO', MetodoPagoVenta.EFECTIVO], // inválido → fallback
    [null, MetodoPagoVenta.EFECTIVO], // ausente → fallback
  ])('mapea método "%s" → %s', async (entrada, esperado) => {
    const self = makeSelf();
    await registrar.call(self, TX, baseParams({ metodoPago: entrada }));
    const call =
      self.cajaService.registrarMovimientoEnCajaOTesoreria.mock.calls[0];
    expect(call[3].metodoPago).toBe(esperado);
  });

  // ── Libro de adelantos (AdelantoOrdenServicio) ──

  it('abono → crea fila del libro con monto, método y usuario', async () => {
    const self = makeSelf();
    const tx = makeTx();
    await registrar.call(self, tx, baseParams({ nota: 'Primer abono' }));

    expect(tx.adelantoOrdenServicio.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ordenServicioId: 'orden-1',
        metodoPago: 'YAPE',
        nota: 'Primer abono',
        creadoPor: 'user-1',
      }),
    });
    const monto = tx.adelantoOrdenServicio.create.mock.calls[0][0].data.monto;
    expect(Number(monto)).toBe(50);
  });

  it('corrección (delta negativo) → fila NEGATIVA con nota de ajuste', async () => {
    const self = makeSelf();
    const tx = makeTx();
    await registrar.call(
      self,
      tx,
      baseParams({ adelantoAnterior: 80, adelantoNuevo: 50 }),
    );

    const data = tx.adelantoOrdenServicio.create.mock.calls[0][0].data;
    expect(Number(data.monto)).toBe(-30);
    expect(data.nota).toContain('Ajuste');
  });

  it('sinFila (anulación) → registra caja pero NO crea fila', async () => {
    const self = makeSelf();
    const tx = makeTx();
    await registrar.call(
      self,
      tx,
      baseParams({ adelantoAnterior: 50, adelantoNuevo: 0, sinFila: true }),
    );

    expect(tx.adelantoOrdenServicio.create).not.toHaveBeenCalled();
    expect(self.cajaService.registrarMovimientoEnCajaOTesoreria)
      .toHaveBeenCalled();
  });

  it('sin cambio (delta 0) → tampoco crea fila del libro', async () => {
    const self = makeSelf();
    const tx = makeTx();
    await registrar.call(
      self,
      tx,
      baseParams({ adelantoAnterior: 50, adelantoNuevo: 50 }),
    );
    expect(tx.adelantoOrdenServicio.create).not.toHaveBeenCalled();
  });
});
