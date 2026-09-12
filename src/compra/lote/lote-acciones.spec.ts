import { LoteService } from './lote.service';

/**
 * Candado de las dos salidas del bloqueo por vencimiento.
 *
 * Cuando un producto de CADUCIDAD vence, el guard de la venta lo frena SIN
 * autorización posible. Y como FEFO pone lo vencido PRIMERO en la fila, ese
 * lote bloquea toda venta de ese producto hasta que alguien haga una de dos
 * cosas: darlo de baja, o corregirle la fecha si se cargó mal.
 *
 * Lo que se fija acá:
 *  1. La baja mueve el LOTE y el STOCK JUNTOS. Mover uno solo rompe la
 *     invariante `Σ lotes = stockActual` y el consumo FEFO empieza a repartir
 *     mercadería que no existe.
 *  2. El movimiento va con `lotesGestionadosPorElLlamador`: acá se elige un
 *     lote CONCRETO, y dejar que el helper consuma por FEFO descontaría de
 *     otro y además dos veces.
 *  3. Corregir la fecha deja RASTRO. Es exactamente lo que haría alguien para
 *     saltarse el bloqueo.
 */
jest.mock('../../producto-stock/movimiento-stock.helper', () => ({
  crearMovimientoStockConValoracion: jest.fn().mockResolvedValue({ id: 'mov-1' }),
}));

import { crearMovimientoStockConValoracion } from '../../producto-stock/movimiento-stock.helper';

describe('LoteService · dar de baja y corregir vencimiento', () => {
  let service: LoteService;
  let tx: any;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  const LOTE = {
    id: 'lote-1',
    codigo: 'LOTE-00000141',
    empresaId: 'emp-1',
    sedeId: 'sede-1',
    cantidadActual: 5,
    precioCosto: 11.8 as any,
    estado: 'ACTIVO',
    fechaVencimiento: new Date('2026-08-13'),
    productoStock: { id: 'ps-1', stockActual: 12 },
    producto: { nombre: 'LECHE 1L' },
    variante: null,
  };

  const build = (lote: any = LOTE) => {
    jest.clearAllMocks();
    tx = {
      lote: {
        findFirst: jest.fn().mockResolvedValue(lote),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...lote, ...data })),
      },
      productoStock: { update: jest.fn().mockResolvedValue({}) },
      movimientoStockLote: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
      lote: {
        findFirst: jest.fn().mockResolvedValue(lote),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...lote, ...data })),
      },
    };
    service = new LoteService(prisma, logger as any);
  };

  describe('dar de baja', () => {
    it('🔑 baja el LOTE y el STOCK juntos, por la misma cantidad', async () => {
      build();

      const r = await service.darDeBaja('lote-1', 'emp-1', 'user-1', {
        cantidad: 3,
        motivo: 'Vencido, se descartó',
      });

      expect(tx.lote.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cantidadActual: 2 }) }),
      );
      expect(tx.productoStock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stockActual: 9 } }),
      );
      expect(r).toMatchObject({ dadasDeBaja: 3, quedanEnLote: 2, stockActual: 9 });
    });

    it('sin cantidad se da de baja TODO lo que queda (el caso del vencido)', async () => {
      build();

      const r = await service.darDeBaja('lote-1', 'emp-1', 'user-1', {
        motivo: 'Venció',
      });

      expect(r.dadasDeBaja).toBe(5);
      expect(r.quedanEnLote).toBe(0);
      // Vacío ⇒ AGOTADO, y sale de la fila FEFO: es lo que DESBLOQUEA la venta.
      expect(tx.lote.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estado: 'AGOTADO' }) }),
      );
    });

    it('🔴 el movimiento NO deja que el helper toque lotes', async () => {
      build();

      await service.darDeBaja('lote-1', 'emp-1', 'user-1', { motivo: 'Venció' });

      expect(crearMovimientoStockConValoracion).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tipo: 'SALIDA_BAJA',
          cantidad: -5,
          // Sin esto el helper consumiría por FEFO: de otro lote, y dos veces.
          lotesGestionadosPorElLlamador: true,
          // Valorado al costo DE ESTE lote, no a un promedio: es la
          // mercadería concreta que se pierde.
          precioCostoUnitario: LOTE.precioCosto,
        }),
      );
    });

    it('deja la contrapartida en la tabla puente', async () => {
      build();

      await service.darDeBaja('lote-1', 'emp-1', 'user-1', { cantidad: 2, motivo: 'x' });

      expect(tx.movimientoStockLote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          movimientoStockId: 'mov-1',
          loteId: 'lote-1',
          cantidad: 2,
        }),
      });
    });

    it('🔴 no deja dar de baja más de lo que hay', async () => {
      build();

      await expect(
        service.darDeBaja('lote-1', 'emp-1', 'user-1', { cantidad: 9, motivo: 'x' }),
      ).rejects.toThrow(/tiene 5 unidades/);
      expect(tx.productoStock.update).not.toHaveBeenCalled();
    });

    it('un lote ya vacío no se da de baja dos veces', async () => {
      build({ ...LOTE, cantidadActual: 0 });

      await expect(
        service.darDeBaja('lote-1', 'emp-1', 'user-1', { motivo: 'x' }),
      ).rejects.toThrow(/ya no tiene unidades/);
    });

    it('el stock nunca queda negativo', async () => {
      // Inconsistencia vieja: el stock ya estaba por debajo del lote.
      build({ ...LOTE, cantidadActual: 5, productoStock: { id: 'ps-1', stockActual: 2 } });

      const r = await service.darDeBaja('lote-1', 'emp-1', 'user-1', { motivo: 'x' });

      expect(r.stockActual).toBe(0);
    });
  });

  describe('corregir vencimiento', () => {
    it('🔴 deja RASTRO de qué decía antes y qué dice ahora', async () => {
      build({ ...LOTE, estado: 'ACTIVO' });

      await service.corregirVencimiento('lote-1', 'emp-1', 'user-1', {
        fechaVencimiento: '2026-12-13',
        motivo: 'El envase dice 13-12',
      });

      const data = prisma.lote.update.mock.calls[0][0].data;
      expect(data.observaciones).toContain('2026-08-13');
      expect(data.observaciones).toContain('2026-12-13');
      expect(data.observaciones).toContain('El envase dice 13-12');
      expect(data.observaciones).toContain('user-1');
    });

    it('🔑 un lote VENCIDO cuya fecha corregida no llegó vuelve a ACTIVO', async () => {
      build({ ...LOTE, estado: 'VENCIDO' });
      const futuro = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

      await service.corregirVencimiento('lote-1', 'emp-1', 'user-1', {
        fechaVencimiento: futuro,
        motivo: 'mal cargada',
      });

      expect(prisma.lote.update.mock.calls[0][0].data.estado).toBe('ACTIVO');
    });

    it('🔴 corregir a una fecha que TAMBIÉN ya pasó no lo revive', async () => {
      build({ ...LOTE, estado: 'VENCIDO' });

      await service.corregirVencimiento('lote-1', 'emp-1', 'user-1', {
        fechaVencimiento: '2026-01-05',
        motivo: 'era enero, no agosto',
      });

      expect(prisma.lote.update.mock.calls[0][0].data.estado).toBeUndefined();
    });

    it('un lote ACTIVO no se marca vencido acá: eso es tarea del cron', async () => {
      build({ ...LOTE, estado: 'ACTIVO' });

      await service.corregirVencimiento('lote-1', 'emp-1', 'user-1', {
        fechaVencimiento: '2026-01-05',
        motivo: 'x',
      });

      expect(prisma.lote.update.mock.calls[0][0].data.estado).toBeUndefined();
    });

    it('se puede dejar SIN vencimiento (se cargó fecha a algo que no vence)', async () => {
      build({ ...LOTE, estado: 'VENCIDO' });

      await service.corregirVencimiento('lote-1', 'emp-1', 'user-1', {
        fechaVencimiento: null,
        motivo: 'este producto no vence',
      });

      const data = prisma.lote.update.mock.calls[0][0].data;
      expect(data.fechaVencimiento).toBeNull();
      expect(data.estado).toBe('ACTIVO');
      expect(data.observaciones).toContain('sin vencimiento');
    });
  });
});
