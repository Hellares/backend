import { Prisma } from '@prisma/client';
import {
  consumirLotesFefo,
  devolverALotesDeOrigen,
  heredarLotesDeTransferencia,
  planificarFefo,
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

  let updates: Array<{ id: string; exige?: any; data: any }>;
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
        // La devolución usa `updateMany` porque condiciona por ESTADO, y
        // `update` exige que el where sea único. Se registra el estado pedido
        // para poder afirmar que un lote VENCIDO no se resucita.
        updateMany: jest.fn(({ where, data }: any) => {
          updates.push({ id: where.id, exige: where.estado, data });
          return Promise.resolve({ count: 1 });
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
      // 🔴 Dos updates por lote, EXCLUYENTES por estado: solo el que estaba
      // AGOTADO vuelve a ACTIVO. Un lote VENCIDO cae en el segundo, que suma
      // la unidad sin resucitarlo — que la mercadería regrese no la hace
      // vendible.
      expect(updates).toEqual([
        { id: 'b', exige: 'AGOTADO', data: { cantidadActual: { increment: 2 }, estado: 'ACTIVO' } },
        { id: 'b', exige: { in: ['ACTIVO', 'VENCIDO'] }, data: { cantidadActual: { increment: 2 } } },
        { id: 'a', exige: 'AGOTADO', data: { cantidadActual: { increment: 2 }, estado: 'ACTIVO' } },
        { id: 'a', exige: { in: ['ACTIVO', 'VENCIDO'] }, data: { cantidadActual: { increment: 2 } } },
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
  describe('transferencia recibida', () => {
    // El lote que salió de la sede de origen.
    const ORIGEN = {
      id: 'lo-1',
      codigo: 'LOTE-00000144',
      numeroLote: 'F-77',
      precioCosto: dec(56.17),
      fechaVencimiento: dia('10-01'),
      fechaProduccion: null,
      proveedorId: 'prov-ceti',
      nombreProveedor: 'CETI',
      compraId: 'c-112',
    };
    const entrada = {
      id: 'mov-in',
      productoStockId: 'ps-dest',
      empresaId: 'emp',
      sedeId: 'sede-lima-0002',
      transferenciaId: 'trf-1',
      usuarioId: 'u1',
    };

    /**
     * @param previas lo que recepciones anteriores de ESTA transferencia ya
     *   heredaron (filas negativas de la tabla puente, por lote de origen)
     * @param existente el lote de destino ya creado por una tanda anterior
     */
    const conTransferencia = (previas: any[] = [], existente: any = null) => {
      conLotes([]);
      tx.movimientoStock = {
        findMany: jest.fn().mockResolvedValue([{ id: 'mov-out', productoStockId: 'ps-origen' }]),
      };
      tx.movimientoStockLote.findMany = jest
        .fn()
        .mockResolvedValueOnce([{ cantidad: 5, lote: ORIGEN }]) // lo que consumió la salida
        .mockResolvedValueOnce(previas);
      tx.lote.findFirst = jest.fn().mockResolvedValue(existente);
      tx.lote.create = jest.fn(({ data }: any) => Promise.resolve({ id: 'lo-dest', data }));
    };

    it('🔑 hereda vencimiento, costo y proveedor del lote de origen', async () => {
      // Sin esto entraba como un lote AJU- sin fecha: la leche que viajaba a
      // la sucursal llegaba "eterna".
      conTransferencia();

      const { asignaciones, sinCubrir } = await heredarLotesDeTransferencia(
        tx, entrada, 5, { productoId: 'p1', varianteId: null },
      );

      expect(tx.lote.create.mock.calls[0][0].data).toMatchObject({
        loteOrigenId: 'lo-1',
        fechaVencimiento: dia('10-01'),
        precioCosto: dec(56.17),
        nombreProveedor: 'CETI',
        proveedorId: 'prov-ceti',
        numeroLote: 'F-77',
        cantidadInicial: 5,
        cantidadActual: 5,
        // El código de origen con la sede pegada: se lee de dónde viene.
        codigo: 'LOTE-00000144/0002',
      });
      expect(asignaciones).toEqual([
        { loteId: 'lo-dest', cantidad: -5, costoUnitario: dec(56.17) },
      ]);
      expect(sinCubrir).toBe(0);
    });

    it('la segunda tanda SUMA al lote ya heredado, sin duplicarlo', async () => {
      // De las 5 que salieron, 3 ya entraron en una recepción anterior.
      conTransferencia(
        [{ cantidad: -3, lote: { loteOrigenId: 'lo-1' } }],
        { id: 'lo-dest' },
      );

      const { asignaciones, sinCubrir } = await heredarLotesDeTransferencia(
        tx, entrada, 2, { productoId: 'p1', varianteId: null },
      );

      expect(tx.lote.create).not.toHaveBeenCalled();
      // Mismo par de updateMany excluyentes que la devolución: solo lo
      // AGOTADO vuelve a ACTIVO; un VENCIDO suma sin resucitar.
      expect(updates.map((u) => u.data.cantidadActual)).toEqual([
        { increment: 2 },
        { increment: 2 },
      ]);
      expect(asignaciones).toEqual([
        { loteId: 'lo-dest', cantidad: -2, costoUnitario: dec(56.17) },
      ]);
      expect(sinCubrir).toBe(0);
    });

    it('no hereda más de lo que la salida consumió', async () => {
      // Salieron 5, ya entraron 3: quedan 2 por heredar aunque lleguen 4. El
      // resto lo cubre el lote de ajuste, como siempre.
      conTransferencia(
        [{ cantidad: -3, lote: { loteOrigenId: 'lo-1' } }],
        { id: 'lo-dest' },
      );

      const { sinCubrir } = await heredarLotesDeTransferencia(
        tx, entrada, 4, { productoId: 'p1', varianteId: null },
      );

      expect(sinCubrir).toBe(2);
    });

    it('si la salida no dejó asignaciones (motor apagado), no hay nada que heredar', async () => {
      conLotes([]);
      tx.movimientoStock = {
        findMany: jest.fn().mockResolvedValue([{ id: 'mov-out', productoStockId: 'ps-origen' }]),
      };
      tx.movimientoStockLote.findMany = jest.fn().mockResolvedValue([]);

      const r = await heredarLotesDeTransferencia(
        tx, entrada, 4, { productoId: 'p1', varianteId: null },
      );

      expect(r).toEqual({ asignaciones: [], sinCubrir: 4 });
    });
  });

  describe('planificarFefo (la previsualización del POS)', () => {
    it('🔑 devuelve el MISMO reparto que el consumo real', async () => {
      const lotes = [lote('a', 3, '03-01', 11.8), lote('b', 10, '06-01', 27.5)];

      // La simulación...
      const { plan, sinCubrir } = planificarFefo(lotes, 5);
      expect(plan.map((p) => [p.lote.id, p.cantidad])).toEqual([
        ['a', 3],
        ['b', 2],
      ]);
      expect(sinCubrir).toBe(0);

      // ...y el consumo de verdad, sobre los mismos lotes.
      conLotes(lotes.map((l) => ({ ...l })));
      const real = await consumirLotesFefo(tx, 'ps-1', 5);
      expect(real.asignaciones.map((a) => [a.loteId, a.cantidad])).toEqual([
        ['a', 3],
        ['b', 2],
      ]);
    });

    it('🔑 el precio ponderado es lo que esas unidades costaron DE VERDAD', () => {
      // El caso que motivó todo: 3 unidades a 11.80 y 2 a 24.36.
      const { plan } = planificarFefo(
        [lote('nuevo', 3, null, 11.8), lote('viejo', 10, null, 24.36)],
        5,
      );
      // `nuevo` primero solo si es más viejo; acá lo fuerzo por el orden de
      // entrada, que es lo que hace el orderBy de la query.
      const cubiertas = plan.reduce((a, p) => a + p.cantidad, 0);
      const ponderado =
        plan.reduce((a, p) => a + Number(p.lote.precioCosto) * p.cantidad, 0) /
        cubiertas;

      expect(cubiertas).toBe(5);
      // 3×11.80 + 2×24.36 = 84.12 → 84.12 / 5
      expect(ponderado).toBeCloseTo(16.824, 6);
      // Y el total cobrado devuelve exactamente lo que costó.
      expect(ponderado * 5).toBeCloseTo(84.12, 6);
    });

    it('informa lo que ningún lote cubre, en vez de inventar un costo', () => {
      const { plan, sinCubrir } = planificarFefo([lote('a', 2, null)], 5);

      expect(plan).toHaveLength(1);
      expect(sinCubrir).toBe(3);
    });
  });
  describe('lote ELEGIDO a mano (compra por encargo)', () => {
    it('🔑 sirve del lote elegido, aunque FEFO habría tomado otro', () => {
      // El caso real: dos compras del mismo producto a proveedores distintos.
      // El cliente pidió el de CETI y su caja cuesta más.
      const deltron = lote('deltron', 6, null, 12.92);
      const ceti = lote('ceti', 10, null, 20.06);

      const { plan } = planificarFefo([deltron, ceti], 10, 'ceti');

      expect(plan).toEqual([{ lote: ceti, cantidad: 10 }]);
    });

    it('sin elegir nada, FEFO manda como siempre', () => {
      const deltron = lote('deltron', 6, null, 12.92);
      const ceti = lote('ceti', 10, null, 20.06);

      const { plan } = planificarFefo([deltron, ceti], 4);

      expect(plan[0].lote.id).toBe('deltron');
    });

    it('si el elegido no alcanza, el resto sale por FEFO', () => {
      const deltron = lote('deltron', 6, null, 12.92);
      const ceti = lote('ceti', 4, null, 20.06);

      const { plan, sinCubrir } = planificarFefo([deltron, ceti], 7, 'ceti');

      expect(plan).toEqual([
        { lote: ceti, cantidad: 4 },
        { lote: deltron, cantidad: 3 },
      ]);
      expect(sinCubrir).toBe(0);
    });

    it('🔴 elegir un lote que no existe NO rompe: cae en FEFO', () => {
      const a = lote('a', 5, null);

      const { plan } = planificarFefo([a], 2, 'lote-borrado');

      expect(plan).toEqual([{ lote: a, cantidad: 2 }]);
    });

    it('🔑 el elegido pasa ADELANTE de uno que vence antes — y se ve', () => {
      // Es el precio de saltear FEFO: la UI tiene que avisarlo, pero el
      // motor obedece. Comprar por encargo es legítimo.
      const vence = lote('vence-pronto', 5, '03-01');
      const encargo = lote('encargo', 5, null);

      const { plan } = planificarFefo([vence, encargo], 3, 'encargo');

      expect(plan[0].lote.id).toBe('encargo');
    });

    it('el consumo real respeta el lote elegido', async () => {
      const deltron = lote('deltron', 6, null, 12.92);
      const ceti = lote('ceti', 10, null, 20.06);
      conLotes([deltron, ceti]);

      const { asignaciones } = await consumirLotesFefo(tx, 'ps-1', 10, 'ceti');

      expect(asignaciones).toEqual([
        { loteId: 'ceti', cantidad: 10, costoUnitario: dec(20.06) },
      ]);
    });
  });
});
