import { Prisma } from '@prisma/client';
import {
  consumirLotesFefo,
  devolverALotesDeOrigen,
} from './lote-consumo.helper';

/**
 * Candado del consumo de lotes.
 *
 * Lo que se fija acá es el ORDEN (FEFO) y el reparto entre varios lotes, que
 * es lo que hace posible el control de vencimientos y lo que hoy no existe:
 * `consumirLotesFIFO` estaba escrita y no la llamaba nadie, así que
 * `Lote.cantidadActual` nunca bajó al vender.
 *
 * 🔴 Nada de esto toca la VALORACIÓN. El kardex sigue costeando toda salida
 * con el promedio ponderado del `ProductoStock`; acá solo se mueven cantidades.
 */
describe('Consumo de lotes (FEFO)', () => {
  const dec = (n: number) => new Prisma.Decimal(n);
  const dia = (d: string) => new Date(`2026-${d}T00:00:00Z`);

  let updates: Array<{ id: string; data: any }>;
  let tx: any;

  /** @param lotes en el orden en que los devolvería el `orderBy` por antigüedad. */
  const conLotes = (lotes: any[]) => {
    updates = [];
    tx = {
      lote: {
        findMany: jest.fn().mockResolvedValue(lotes),
        update: jest.fn(({ where, data }: any) => {
          updates.push({ id: where.id, data });
          return Promise.resolve({});
        }),
      },
      movimientoStockLote: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  };

  const lote = (
    id: string,
    cantidadActual: number,
    vence: string | null,
    costo = 10,
  ) => ({
    id,
    cantidadActual,
    precioCosto: dec(costo),
    fechaVencimiento: vence ? dia(vence) : null,
  });

  it('🔑 sale primero lo que VENCE antes, no lo que llegó antes', async () => {
    // El viejo llegó primero pero no vence nunca; el nuevo caduca en marzo.
    conLotes([lote('viejo', 10, null), lote('nuevo', 10, '03-01')]);

    const { asignaciones } = await consumirLotesFefo(tx, 'ps-1', 4);

    expect(asignaciones).toEqual([
      { loteId: 'nuevo', cantidad: 4, costoUnitario: dec(10) },
    ]);
  });

  it('entre los que vencen, primero el más próximo', async () => {
    conLotes([lote('junio', 10, '06-01'), lote('marzo', 10, '03-01')]);

    const { asignaciones } = await consumirLotesFefo(tx, 'ps-1', 3);

    expect(asignaciones[0].loteId).toBe('marzo');
  });

  it('entre los que NO vencen, el más antiguo (FEFO degenera en FIFO)', async () => {
    // Llegan en orden de antigüedad desde la query.
    conLotes([lote('primero', 5, null), lote('segundo', 5, null)]);

    const { asignaciones } = await consumirLotesFefo(tx, 'ps-1', 2);

    expect(asignaciones[0].loteId).toBe('primero');
  });

  it('🔑 una sola salida come de VARIOS lotes — el caso que obliga a la tabla puente', async () => {
    conLotes([lote('a', 3, '03-01', 11.8), lote('b', 10, '06-01', 27.5)]);

    const { asignaciones, sinCubrir } = await consumirLotesFefo(tx, 'ps-1', 5);

    expect(asignaciones).toEqual([
      { loteId: 'a', cantidad: 3, costoUnitario: dec(11.8) },
      { loteId: 'b', cantidad: 2, costoUnitario: dec(27.5) },
    ]);
    expect(sinCubrir).toBe(0);
  });

  it('el lote que llega a cero queda AGOTADO; el que no, sigue ACTIVO', async () => {
    conLotes([lote('a', 3, '03-01'), lote('b', 10, '06-01')]);

    await consumirLotesFefo(tx, 'ps-1', 5);

    expect(updates).toEqual([
      { id: 'a', data: { cantidadActual: 0, estado: 'AGOTADO' } },
      { id: 'b', data: { cantidadActual: 8 } },
    ]);
  });

  it('🔴 si los lotes no alcanzan NO se aborta: se informa el faltante', async () => {
    // Frenar el cobro por una inconsistencia de lotes que el cajero no puede
    // resolver en el mostrador sería peor que la inconsistencia.
    conLotes([lote('unico', 2, null)]);

    const { asignaciones, sinCubrir } = await consumirLotesFefo(tx, 'ps-1', 5);

    expect(asignaciones).toEqual([
      { loteId: 'unico', cantidad: 2, costoUnitario: dec(10) },
    ]);
    expect(sinCubrir).toBe(3);
  });

  it('sin lotes no explota', async () => {
    conLotes([]);

    const { asignaciones, sinCubrir } = await consumirLotesFefo(tx, 'ps-1', 4);

    expect(asignaciones).toEqual([]);
    expect(sinCubrir).toBe(4);
    expect(tx.lote.update).not.toHaveBeenCalled();
  });

  describe('devolución', () => {
    it('🔑 vuelve a los lotes de los que SALIÓ, con su costo', async () => {
      // La leche devuelta sigue venciendo el día que vencía: reponerla en un
      // lote nuevo perdería justo el dato que importa.
      conLotes([]);
      tx.movimientoStockLote.findMany.mockResolvedValue([
        { loteId: 'b', cantidad: 2, costoUnitario: dec(27.5) },
        { loteId: 'a', cantidad: 3, costoUnitario: dec(11.8) },
      ]);

      const { asignaciones, sinCubrir } = await devolverALotesDeOrigen(
        tx,
        ['mov-1'],
        4,
      );

      // Orden inverso al consumo: lo último que salió es lo primero que vuelve.
      expect(asignaciones).toEqual([
        { loteId: 'b', cantidad: -2, costoUnitario: dec(27.5) },
        { loteId: 'a', cantidad: -2, costoUnitario: dec(11.8) },
      ]);
      expect(sinCubrir).toBe(0);
      expect(updates).toEqual([
        { id: 'b', data: { cantidadActual: { increment: 2 }, estado: 'ACTIVO' } },
        { id: 'a', data: { cantidadActual: { increment: 2 }, estado: 'ACTIVO' } },
      ]);
    });

    it('no repone dos veces la misma unidad si se devuelve en tandas', async () => {
      conLotes([]);
      tx.movimientoStockLote.findMany.mockResolvedValue([
        { loteId: 'a', cantidad: 3, costoUnitario: dec(11.8) },
      ]);
      // De las 3 que salieron, 2 ya volvieron en una devolución anterior.
      tx.movimientoStockLote.groupBy.mockResolvedValue([
        { loteId: 'a', _sum: { cantidad: -2 } },
      ]);

      const { asignaciones, sinCubrir } = await devolverALotesDeOrigen(
        tx,
        ['mov-1'],
        3,
      );

      expect(asignaciones).toEqual([
        { loteId: 'a', cantidad: -1, costoUnitario: dec(11.8) },
      ]);
      // Las otras 2 no tienen a dónde volver por este camino.
      expect(sinCubrir).toBe(2);
    });

    it('sin movimiento de origen, no inventa: devuelve todo como sin cubrir', async () => {
      conLotes([]);

      const { asignaciones, sinCubrir } = await devolverALotesDeOrigen(tx, [], 5);

      expect(asignaciones).toEqual([]);
      expect(sinCubrir).toBe(5);
    });
  });
});
