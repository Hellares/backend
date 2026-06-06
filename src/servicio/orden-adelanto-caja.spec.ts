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
 * - |delta| < 0.01 → no toca caja.
 * - método inválido/ausente → fallback EFECTIVO.
 * - usa registrarMovimientoEnCajaOTesoreria (sin caja abierta cae a Caja
 *   Central — el dinero nunca se pierde).
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

const TX = {} as any;

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

  it('sin sedeId → no toca caja (warn, no rompe)', async () => {
    const self = makeSelf();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await registrar.call(self, TX, baseParams({ sedeId: null }));
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
});
