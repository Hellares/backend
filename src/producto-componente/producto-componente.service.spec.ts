import { ProductoComponenteService } from './producto-componente.service';

/**
 * Tests del módulo Producto Compuesto / BOM, con foco en `fabricar()` —
 * la pieza más delicada del sistema (toca stock, recalcula costo por
 * promedio ponderado, escribe kardex PRODUCCION_* y corre en una sola
 * transacción atómica) y que estaba EN PROD sin cobertura.
 *
 * Mockeamos prisma/cache (no usa infra real). `$transaction` ejecuta el
 * callback con un `tx` mockeado, igual que producto-variante-softdelete.spec.
 * El helper `crearMovimientoStockConValoracion` se mockea a nivel de módulo
 * para contar/inspeccionar los movimientos de kardex generados.
 */
jest.mock('../producto-stock/movimiento-stock.helper', () => ({
  crearMovimientoStockConValoracion: jest.fn().mockResolvedValue({}),
}));
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';

const movMock = crearMovimientoStockConValoracion as jest.Mock;

// ─── builders ──────────────────────────────────────────────────

// Una fila de receta (ProductoComponente con su componente incluido).
// `componenteVarianteId` null = insumo sin variantes (producto base).
const recetaItem = (componenteId: string, cantidad: number, nombre: string) => ({
  id: `r-${componenteId}`,
  productoId: 'pf',
  componenteId,
  componenteVarianteId: null,
  cantidad, // el service hace Number(); un number plano vale como Decimal
  componente: { id: componenteId, nombre },
});

// Fila de receta cuyo componente es una VARIANTE del insumo (ej. "Planta T20").
const recetaItemVar = (
  componenteId: string,
  componenteVarianteId: string,
  cantidad: number,
  nombre: string,
) => ({
  id: `r-${componenteVarianteId}`,
  productoId: 'pf',
  componenteId,
  componenteVarianteId,
  cantidad,
  componente: { id: componenteId, nombre },
});

// Una fila de ProductoStock como la devuelve el $queryRaw FOR UPDATE.
// precioCosto llega como string | null (cast de Postgres). varianteId null =
// stock del producto base; productoId null + varianteId = stock de variante.
const stockRow = (
  productoId: string,
  stockActual: number,
  precioCosto: string | null,
) => ({ id: `sc-${productoId}`, productoId, varianteId: null, stockActual, precioCosto });

// Stock de una VARIANTE de insumo (productoId null + varianteId set, XOR).
const stockRowVariante = (
  varianteId: string,
  stockActual: number,
  precioCosto: string | null,
) => ({ id: `sc-${varianteId}`, productoId: null, varianteId, stockActual, precioCosto });

const mkTx = (opts: {
  stockRows?: any[];
  finalStock?: any | null;
  createdFinal?: any;
}) => {
  // El stock final ahora se lockea con $queryRaw FOR UPDATE (no findFirst).
  // 1er $queryRaw = lock de insumos (stockRows); 2do = lock del stock final.
  const finalRows = opts.finalStock
    ? [
        {
          id: opts.finalStock.id,
          stockActual: opts.finalStock.stockActual,
          precioCosto: opts.finalStock.precioCosto ?? null,
        },
      ]
    : [];
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce(opts.stockRows ?? [])
      .mockResolvedValueOnce(finalRows),
    productoStock: {
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockResolvedValue(
          opts.createdFinal ?? {
            id: 'sf-new',
            stockActual: 0,
            precioCosto: null,
          },
        ),
    },
    productoPrecioHistorialSede: { create: jest.fn().mockResolvedValue({}) },
  };
};

const mkService = (opts: {
  producto?: any;
  receta?: any[];
  stockRows?: any[];
  finalStock?: any | null;
  createdFinal?: any;
  numVariantes?: number; // cuántas variantes tiene el producto (default 0)
  variante?: any; // lo que devuelve productoVariante.findFirst (assertVariante)
}) => {
  const tx = mkTx(opts);
  const prisma = {
    producto: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pf' }), // _assertProductoPerteneceAEmpresa
      findUnique: jest.fn().mockResolvedValue(
        opts.producto ?? {
          id: 'pf',
          nombre: 'Peluche',
          esInsumo: false,
          empresaId: 'e1',
        },
      ),
    },
    productoVariante: {
      count: jest.fn().mockResolvedValue(opts.numVariantes ?? 0),
      findFirst: jest.fn().mockResolvedValue(opts.variante ?? { id: 'var1' }),
    },
    productoComponente: { findMany: jest.fn().mockResolvedValue(opts.receta ?? []) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const cache = {
    invalidateProductosLists: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProductoComponenteService(prisma as any, cache as any);
  return { service, prisma, tx, cache };
};

const DTO = (cantidad: number) => ({
  sedeId: 's1',
  cantidad,
  observaciones: 'obs',
});

const DTOV = (cantidad: number, varianteId: string) => ({
  sedeId: 's1',
  cantidad,
  varianteId,
  observaciones: 'obs',
});

// Encuentra la llamada a productoStock.update por id del where.
const updateCallFor = (tx: any, id: string) =>
  tx.productoStock.update.mock.calls.find((c: any[]) => c[0].where.id === id);

beforeEach(() => movMock.mockClear());

// ─── fabricar() ────────────────────────────────────────────────

describe('ProductoComponenteService.fabricar', () => {
  it('happy path sin stock previo: descuenta insumos, crea final, costo = lote/cantidad', async () => {
    // Receta: 2 Algodón + 1 Tela por unidad. Fabricar 3 → 6 Algodón, 3 Tela.
    const { service, tx } = mkService({
      receta: [
        recetaItem('algodon', 2, 'Algodón'),
        recetaItem('tela', 1, 'Tela'),
      ],
      stockRows: [
        stockRow('algodon', 100, '2'),
        stockRow('tela', 50, '5'),
      ],
      finalStock: null, // no hay stock previo del producto final
    });

    const r = await service.fabricar('e1', 'pf', DTO(3), 'u1');

    // Descuento de insumos (stockActual - consumido)
    expect(updateCallFor(tx, 'sc-algodon')![0].data).toEqual({ stockActual: 94 });
    expect(updateCallFor(tx, 'sc-tela')![0].data).toEqual({ stockActual: 47 });

    // Crea el stock del producto final con costo = (6*2 + 3*5) / 3 = 27/3 = 9
    expect(tx.productoStock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sedeId: 's1',
          productoId: 'pf',
          stockActual: 3,
          precioCosto: 9,
        }),
      }),
    );

    // 2 movimientos PRODUCCION_SALIDA + 1 PRODUCCION_ENTRADA
    expect(movMock).toHaveBeenCalledTimes(3);
    const tipos = movMock.mock.calls.map((c) => c[1].tipo);
    expect(tipos.filter((t) => t === 'PRODUCCION_SALIDA')).toHaveLength(2);
    expect(tipos.filter((t) => t === 'PRODUCCION_ENTRADA')).toHaveLength(1);

    // Historial de precio (de null → 9)
    expect(tx.productoPrecioHistorialSede.create).toHaveBeenCalledTimes(1);

    expect(r.cantidadProducida).toBe(3);
    expect(r.stockFinalNuevo).toBe(3);
    expect(r.precioCostoNuevo).toBe(9);
    expect(r.costoActualizado).toBe(true);
    expect(r.numeroDocumento).toMatch(/^PROD-/);
  });

  it('promedio ponderado con stock previo + redondeo a 2 decimales', async () => {
    // Final ya tiene 10 unidades a costo 5. Receta: 1 X por unidad (costo 4).
    // Fabricar 3 → consumo 3, costoLote = 3*4 = 12.
    // valorPrevio = 10*5 = 50; valorTotal = 62; stockNuevo = 13.
    // nuevoCosto = 62/13 = 4.769... → 4.77
    const { service, tx } = mkService({
      receta: [recetaItem('x', 1, 'Insumo X')],
      stockRows: [stockRow('x', 100, '4')],
      finalStock: { id: 'sf', stockActual: 10, precioCosto: '5' },
    });

    const r = await service.fabricar('e1', 'pf', DTO(3), 'u1');

    expect(updateCallFor(tx, 'sf')![0].data).toEqual({
      stockActual: 13,
      precioCosto: 4.77,
    });
    expect(r.precioCostoAnterior).toBe(5);
    expect(r.precioCostoNuevo).toBe(4.77);
    expect(r.costoActualizado).toBe(true);
    // Historial registra el cambio de costo (5 → 4.77)
    expect(tx.productoPrecioHistorialSede.create).toHaveBeenCalledTimes(1);
  });

  it('mano de obra: se suma al costo del lote y al ponderado; la entrada vale el lote', async () => {
    // 1 insumo (1 × 5 = 5/u). Fabricar 2 → insumos 10. M.O. 6 → lote 16.
    // Sin stock previo → precioCostoNuevo = 16/2 = 8.
    const { service, tx } = mkService({
      receta: [recetaItem('x', 1, 'Insumo X')],
      stockRows: [stockRow('x', 100, '5')],
      finalStock: null,
    });

    const r = await service.fabricar(
      'e1',
      'pf',
      { ...DTO(2), costoManoObra: 6 } as any,
      'u1',
    );

    // Costo del producto incluye mano de obra
    expect(tx.productoStock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ precioCosto: 8 }),
      }),
    );
    // El movimiento de ENTRADA se valora al costo del lote (16/2 = 8/u)
    const entrada = movMock.mock.calls.find(
      (c) => c[1].tipo === 'PRODUCCION_ENTRADA',
    );
    expect(entrada![1].precioCostoUnitario).toBe(8);
    // Desglose en el response
    expect(r.costoInsumos).toBe(10);
    expect(r.costoManoObra).toBe(6);
    expect(r.costoLoteTotal).toBe(16);
    expect(r.costoUnitarioLote).toBe(8);
  });

  it('cantidad fraccionaria por componente → 400 y NO abre transacción', async () => {
    // 0.5 por unidad × 3 = 1.5 (no entero) → no se puede descontar de stock Int.
    const { service, prisma } = mkService({
      receta: [recetaItem('x', 0.5, 'Insumo X')],
    });

    await expect(service.fabricar('e1', 'pf', DTO(3), 'u1')).rejects.toMatchObject({
      response: { code: 'FABRICACION_CANTIDAD_FRACCIONARIA' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(movMock).not.toHaveBeenCalled();
  });

  it('fracción por unidad pero total entero (0.25 × 4 = 1) SÍ fabrica', async () => {
    // Caso real: insumo a 0.25 KG por unidad; fabricar 4 consume 1 KG exacto.
    const { service, tx } = mkService({
      receta: [recetaItem('x', 0.25, 'Insumo X')],
      stockRows: [stockRow('x', 10, '8')],
      finalStock: null,
    });

    const r = await service.fabricar('e1', 'pf', DTO(4), 'u1');

    // Consume 1 entero (10 - 1 = 9)
    expect(updateCallFor(tx, 'sc-x')![0].data).toEqual({ stockActual: 9 });
    // costo = (1 * 8) / 4 = 2
    expect(r.precioCostoNuevo).toBe(2);
    expect(r.costoActualizado).toBe(true);
  });

  it('stock insuficiente → 400 dentro de la tx y NO descuenta nada', async () => {
    const { service, prisma, tx } = mkService({
      receta: [recetaItem('x', 1, 'Insumo X')],
      stockRows: [stockRow('x', 5, '4')], // hay 5, se necesitan 10
    });

    await expect(service.fabricar('e1', 'pf', DTO(10), 'u1')).rejects.toMatchObject({
      response: { code: 'FABRICACION_STOCK_INSUFICIENTE' },
    });
    // La transacción se abrió (la validación de stock está adentro)...
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // ...pero abortó antes de tocar stock o kardex.
    expect(tx.productoStock.update).not.toHaveBeenCalled();
    expect(movMock).not.toHaveBeenCalled();
  });

  it('producto marcado como insumo → 400 y NO abre transacción', async () => {
    const { service, prisma } = mkService({
      producto: { id: 'pf', nombre: 'Tela', esInsumo: true, empresaId: 'e1' },
      receta: [recetaItem('x', 1, 'Insumo X')],
    });

    await expect(service.fabricar('e1', 'pf', DTO(1), 'u1')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('producto sin receta → 400 y NO abre transacción', async () => {
    const { service, prisma } = mkService({ receta: [] });

    await expect(service.fabricar('e1', 'pf', DTO(1), 'u1')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('insumo sin precioCosto → fabrica pero NO actualiza costo del final ni escribe historial', async () => {
    const { service, tx } = mkService({
      receta: [recetaItem('x', 1, 'Insumo X')],
      stockRows: [stockRow('x', 100, null)], // sin costo
      finalStock: { id: 'sf', stockActual: 0, precioCosto: null },
    });

    const r = await service.fabricar('e1', 'pf', DTO(2), 'u1');

    // El stock del final sube pero el update NO incluye precioCosto.
    const finalCall = updateCallFor(tx, 'sf')!;
    expect(finalCall[0].data).toEqual({ stockActual: 2 });
    expect(finalCall[0].data.precioCosto).toBeUndefined();

    expect(r.costoActualizado).toBe(false);
    expect(r.razonCostoNoActualizado).toContain('Insumo X');
    // Sin cambio de costo no se escribe historial de precio.
    expect(tx.productoPrecioHistorialSede.create).not.toHaveBeenCalled();
    // Igual descuenta insumo y suma final (2 movimientos).
    expect(movMock).toHaveBeenCalledTimes(2);
  });

  it('invalida el cache de listados tras fabricar', async () => {
    const { service, cache } = mkService({
      receta: [recetaItem('x', 1, 'Insumo X')],
      stockRows: [stockRow('x', 100, '4')],
      finalStock: null,
    });

    await service.fabricar('e1', 'pf', DTO(1), 'u1');
    expect(cache.invalidateProductosLists).toHaveBeenCalledWith('e1');
  });
});

// ─── fabricar() por variante ───────────────────────────────────

describe('ProductoComponenteService.fabricar — por variante', () => {
  it('fabrica una variante: stock destino y costo van a la VARIANTE', async () => {
    // Producto con variantes; receta de la talla: 3 Algodón. Fabricar 2 → 6.
    const { service, tx } = mkService({
      numVariantes: 3,
      variante: { id: 'tallaL' },
      receta: [recetaItem('algodon', 3, 'Algodón')],
      stockRows: [stockRow('algodon', 100, '2')],
      finalStock: null,
    });

    const r = await service.fabricar('e1', 'pf', DTOV(2, 'tallaL'), 'u1');

    // El stock final creado es de la variante: varianteId set y productoId
    // null (XOR de ProductoStock).
    expect(tx.productoStock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productoId: null,
          varianteId: 'tallaL',
          stockActual: 2,
          precioCosto: 6, // (6 * 2) / 2
        }),
      }),
    );
    // El stock final se lockeó con $queryRaw FOR UPDATE (insumos + final = 2).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(r.varianteId).toBe('tallaL');
    expect(r.cantidadProducida).toBe(2);
  });

  it('soloConsumirInsumos: descuenta insumos pero NO toca el stock final ni el costo', async () => {
    const { service, tx } = mkService({
      numVariantes: 3,
      variante: { id: 'tallaL' },
      receta: [recetaItem('algodon', 3, 'Algodón')],
      stockRows: [stockRow('algodon', 100, '2')],
      finalStock: { id: 'sf', stockActual: 25, precioCosto: '50' },
    });

    const r = await service.fabricar(
      'e1',
      'pf',
      { ...DTOV(5, 'tallaL'), soloConsumirInsumos: true } as any,
      'u1',
    );

    // Descuenta el insumo (3 × 5 = 15 → 100-15=85)
    expect(updateCallFor(tx, 'sc-algodon')![0].data).toEqual({ stockActual: 85 });
    // NO toca el stock del producto final ni lo crea
    expect(updateCallFor(tx, 'sf')).toBeUndefined();
    expect(tx.productoStock.create).not.toHaveBeenCalled();
    // NO escribe historial de costo
    expect(tx.productoPrecioHistorialSede.create).not.toHaveBeenCalled();
    // Solo 1 movimiento: PRODUCCION_SALIDA (sin ENTRADA)
    expect(movMock).toHaveBeenCalledTimes(1);
    expect(movMock.mock.calls[0][1].tipo).toBe('PRODUCCION_SALIDA');
    // El response refleja el modo
    expect(r.soloConsumoInsumos).toBe(true);
    expect(r.cantidadProducida).toBe(0);
    expect(r.unidadesRegistradas).toBe(5);
    expect(r.costoActualizado).toBe(false);
  });

  it('producto CON variantes sin varianteId → 400 y NO abre transacción', async () => {
    const { service, prisma } = mkService({
      numVariantes: 3,
      receta: [recetaItem('x', 1, 'X')],
    });
    await expect(
      service.fabricar('e1', 'pf', DTO(1), 'u1'),
    ).rejects.toThrow(/variante/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('producto SIN variantes con varianteId → 400 y NO abre transacción', async () => {
    const { service, prisma } = mkService({
      numVariantes: 0,
      receta: [recetaItem('x', 1, 'X')],
    });
    await expect(
      service.fabricar('e1', 'pf', DTOV(1, 'tallaL'), 'u1'),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── fabricar() con componente = VARIANTE de insumo ────────────

describe('ProductoComponenteService.fabricar — componente es variante de insumo', () => {
  it('consume el stock de la VARIANTE del insumo (no del producto base)', async () => {
    // Receta usa "Planta T20" (variante del insumo). 2 por unidad, fabricar 3
    // → consume 6 de la variante. Stock de la variante: 50 @ 7.
    const { service, tx } = mkService({
      receta: [recetaItemVar('planta', 'plantaT20', 2, 'Planta')],
      stockRows: [stockRowVariante('plantaT20', 50, '7')],
      finalStock: null,
    });

    const r = await service.fabricar('e1', 'pf', DTO(3), 'u1');

    // Descuenta el stock de la VARIANTE (id sc-plantaT20), no del base.
    expect(updateCallFor(tx, 'sc-plantaT20')![0].data).toEqual({
      stockActual: 44,
    });
    // Costo final = (6 × 7) / 3 = 14.
    expect(r.precioCostoNuevo).toBe(14);
    expect(r.costoActualizado).toBe(true);
  });

  it('receta mixta: un insumo base + una variante de insumo', async () => {
    const { service, tx } = mkService({
      receta: [
        recetaItem('hilo', 1, 'Hilo'),
        recetaItemVar('planta', 'plantaT20', 2, 'Planta'),
      ],
      stockRows: [
        stockRow('hilo', 100, '1'),
        stockRowVariante('plantaT20', 50, '7'),
      ],
      finalStock: null,
    });

    await service.fabricar('e1', 'pf', DTO(1), 'u1');

    // El base se descuenta por productoId; la variante por su stock propio.
    expect(updateCallFor(tx, 'sc-hilo')![0].data).toEqual({ stockActual: 99 });
    expect(updateCallFor(tx, 'sc-plantaT20')![0].data).toEqual({
      stockActual: 48,
    });
  });

  it('stock insuficiente en la variante del insumo → 400', async () => {
    const { service } = mkService({
      receta: [recetaItemVar('planta', 'plantaT20', 10, 'Planta')],
      stockRows: [stockRowVariante('plantaT20', 5, '7')], // hay 5, se necesitan 10
    });

    await expect(
      service.fabricar('e1', 'pf', DTO(1), 'u1'),
    ).rejects.toMatchObject({
      response: { code: 'FABRICACION_STOCK_INSUFICIENTE' },
    });
  });
});

// ─── copiarRecetaAVariante() ────────────────────────────────────

describe('ProductoComponenteService.copiarRecetaAVariante', () => {
  const mkCopiar = (opts: { base?: any[]; existentes?: any[] }) => {
    const tx = {
      productoComponente: {
        // El chequeo de existentes ahora corre DENTRO de la tx.
        findMany: jest.fn().mockResolvedValue(opts.existentes ?? []),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'pf' }) },
      productoVariante: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tallaL' }),
      },
      productoComponente: {
        // Solo la receta base se lee con prisma (fuera de la tx).
        findMany: jest.fn().mockResolvedValue(opts.base ?? []),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);
    return { service, prisma, tx };
  };

  it('copia la receta base a la variante (variante vacía)', async () => {
    const { service, tx } = mkCopiar({
      base: [
        { componenteId: 'a', cantidad: 2, notas: null },
        { componenteId: 'b', cantidad: 1, notas: 'hilo' },
      ],
      existentes: [],
    });

    const r = await service.copiarRecetaAVariante('e1', 'pf', {
      varianteId: 'tallaL',
    } as any);

    expect(tx.productoComponente.deleteMany).not.toHaveBeenCalled();
    expect(tx.productoComponente.createMany).toHaveBeenCalledWith({
      data: [
        { productoId: 'pf', varianteId: 'tallaL', componenteId: 'a', cantidad: 2, notas: null },
        { productoId: 'pf', varianteId: 'tallaL', componenteId: 'b', cantidad: 1, notas: 'hilo' },
      ],
    });
    expect(r).toEqual({ varianteId: 'tallaL', copiados: 2 });
  });

  it('si la variante ya tiene receta y NO sobrescribir → Conflict, sin copiar', async () => {
    const { service, tx } = mkCopiar({
      base: [{ componenteId: 'a', cantidad: 2, notas: null }],
      existentes: [{ id: 'x' }],
    });
    await expect(
      service.copiarRecetaAVariante('e1', 'pf', { varianteId: 'tallaL' } as any),
    ).rejects.toThrow(/ya tiene receta/i);
    // El chequeo corre dentro de la tx, pero no debe copiar ni borrar.
    expect(tx.productoComponente.createMany).not.toHaveBeenCalled();
    expect(tx.productoComponente.deleteMany).not.toHaveBeenCalled();
  });

  it('sobrescribir=true: borra la receta previa de la variante y copia', async () => {
    const { service, tx } = mkCopiar({
      base: [{ componenteId: 'a', cantidad: 2, notas: null }],
      existentes: [{ id: 'x' }],
    });
    await service.copiarRecetaAVariante('e1', 'pf', {
      varianteId: 'tallaL',
      sobrescribir: true,
    } as any);
    expect(tx.productoComponente.deleteMany).toHaveBeenCalledWith({
      where: { productoId: 'pf', varianteId: 'tallaL' },
    });
    expect(tx.productoComponente.createMany).toHaveBeenCalledTimes(1);
  });

  it('sin receta base → 400', async () => {
    const { service } = mkCopiar({ base: [], existentes: [] });
    await expect(
      service.copiarRecetaAVariante('e1', 'pf', { varianteId: 'tallaL' } as any),
    ).rejects.toThrow(/receta base/i);
  });
});

// ─── calcularCosto() ───────────────────────────────────────────

describe('ProductoComponenteService.calcularCosto', () => {
  const mkCalcService = (opts: { receta?: any[]; stocks?: any[] }) => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'pf' }) },
      productoComponente: {
        findMany: jest.fn().mockResolvedValue(opts.receta ?? []),
      },
      productoStock: {
        findMany: jest.fn().mockResolvedValue(opts.stocks ?? []),
      },
    };
    return new ProductoComponenteService(prisma as any, {} as any);
  };

  it('suma (cantidad × precioCosto) de todos los componentes', async () => {
    const service = mkCalcService({
      receta: [
        { componenteId: 'a', cantidad: 2, componente: { id: 'a', nombre: 'A' } },
        { componenteId: 'b', cantidad: 3, componente: { id: 'b', nombre: 'B' } },
      ],
      stocks: [
        { productoId: 'a', precioCosto: 5 },
        { productoId: 'b', precioCosto: 4 },
      ],
    });

    const r = await service.calcularCosto('e1', 'pf', 's1');
    // 2*5 + 3*4 = 22
    expect(r.costoTotal).toBe(22);
    expect(r.cantidadComponentes).toBe(2);
    expect(r.componentesSinCosto).toEqual([]);
  });

  it('reporta componentesSinCosto y NO los cuenta en el total', async () => {
    const service = mkCalcService({
      receta: [
        { componenteId: 'a', cantidad: 2, componente: { id: 'a', nombre: 'A' } },
        { componenteId: 'b', cantidad: 3, componente: { id: 'b', nombre: 'B' } },
      ],
      stocks: [{ productoId: 'a', precioCosto: 5 }], // b sin stock/costo en sede
    });

    const r = await service.calcularCosto('e1', 'pf', 's1');
    expect(r.costoTotal).toBe(10); // solo 2*5
    expect(r.componentesSinCosto).toEqual([{ id: 'b', nombre: 'B' }]);
  });

  it('sin receta → costoTotal 0', async () => {
    const service = mkCalcService({ receta: [] });
    const r = await service.calcularCosto('e1', 'pf', 's1');
    expect(r).toMatchObject({ costoTotal: 0, cantidadComponentes: 0 });
  });
});

// ─── crear() — validaciones de integridad ──────────────────────

describe('ProductoComponenteService.crear — validaciones', () => {
  it('rechaza auto-referencia (producto como componente de sí mismo)', async () => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'pf' }) },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await expect(
      service.crear('e1', 'pf', { componenteId: 'pf', cantidad: 1 } as any),
    ).rejects.toThrow(/sí mismo/);
  });

  it('rechaza ciclo directo (el componente ya usa al producto como insumo)', async () => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) },
      productoVariante: { count: jest.fn().mockResolvedValue(0) },
      productoComponente: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ciclo' }),
      },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await expect(
      service.crear('e1', 'pf', { componenteId: 'otro', cantidad: 1 } as any),
    ).rejects.toThrow(/[Cc]iclo/);
  });

  it('componente duplicado (P2002) → ConflictException', async () => {
    const p2002 = Object.assign(new Error('dup'), { code: 'P2002' });
    // Forzamos que sea instancia reconocible por el catch del service.
    const { Prisma } = require('@prisma/client');
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);

    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) },
      productoVariante: { count: jest.fn().mockResolvedValue(0) },
      productoComponente: {
        findFirst: jest.fn().mockResolvedValue(null), // sin ciclo
        create: jest.fn().mockRejectedValue(p2002),
      },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await expect(
      service.crear('e1', 'pf', { componenteId: 'otro', cantidad: 1 } as any),
    ).rejects.toThrow(/ya está en la receta/);
  });

  it('insumo CON variantes sin componenteVarianteId → 400', async () => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) },
      productoVariante: { count: jest.fn().mockResolvedValue(3) },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await expect(
      service.crear('e1', 'pf', { componenteId: 'planta', cantidad: 1 } as any),
    ).rejects.toThrow(/variante/i);
  });

  it('insumo SIN variantes con componenteVarianteId → 400', async () => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) },
      productoVariante: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await expect(
      service.crear('e1', 'pf', {
        componenteId: 'planta',
        componenteVarianteId: 'v20',
        cantidad: 1,
      } as any),
    ).rejects.toThrow(/no tiene variantes/i);
  });

  it('crea componente con variante de insumo válida → create incluye componenteVarianteId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'nuevo' });
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) },
      productoVariante: {
        count: jest.fn().mockResolvedValue(3),
        // _assertVariantePerteneceAProducto (variante pertenece al insumo)
        findFirst: jest.fn().mockResolvedValue({ id: 'v20' }),
      },
      productoComponente: {
        findFirst: jest.fn().mockResolvedValue(null), // sin ciclo ni duplicado
        create,
      },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);

    await service.crear('e1', 'pf', {
      componenteId: 'planta',
      componenteVarianteId: 'v20',
      cantidad: 2,
    } as any);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          componenteId: 'planta',
          componenteVarianteId: 'v20',
        }),
      }),
    );
  });
});

// ─── detalleFabricacion() — resolución de insumos base y variante ──
//
// Regresión: el feature de BOM con insumo-variante hizo que el stock del
// insumo viva con productoId NULL + varianteId set. detalleFabricacion solo
// seleccionaba `producto`, así que los insumos-variante (y el producto final
// cuando es una variante) salían con nombre/código/unidad vacíos y sin última
// compra. El fix selecciona también `variante` y resuelve con fallback.

describe('ProductoComponenteService.detalleFabricacion', () => {
  // Unidad de medida tal como la trae el select (simboloLocal gana).
  const um = (simbolo: string) => ({
    simboloLocal: simbolo,
    simboloPersonalizado: null,
    unidadMaestra: { simbolo: simbolo.toUpperCase() },
  });

  // Movimiento base (productoStock de producto, sin variante).
  const movBase = (
    tipo: 'PRODUCCION_ENTRADA' | 'PRODUCCION_SALIDA',
    over: Record<string, any>,
    prod: { id: string; nombre: string; codigo: string; um: any },
  ) => ({
    id: `m-${prod.id}`,
    tipo,
    cantidad: 0,
    cantidadAnterior: 0,
    cantidadNueva: 0,
    valorMovimiento: null,
    precioCostoUnitario: null,
    costoManoObra: null,
    observaciones: null,
    creadoEn: new Date('2026-05-10T00:00:00Z'),
    sede: { id: 's1', nombre: 'Sede 1' },
    productoStock: {
      id: `sc-${prod.id}`,
      precioCosto: null,
      producto: {
        id: prod.id,
        nombre: prod.nombre,
        codigoEmpresa: prod.codigo,
        unidadMedida: prod.um,
      },
      variante: null,
    },
    ...over,
  });

  // Movimiento de una VARIANTE (productoStock con productoId NULL + variante).
  const movVar = (
    tipo: 'PRODUCCION_ENTRADA' | 'PRODUCCION_SALIDA',
    over: Record<string, any>,
    v: {
      id: string;
      nombre: string;
      codigo: string;
      um: any;
      baseId: string;
      baseNombre: string;
      baseUm: any;
    },
  ) => ({
    id: `m-${v.id}`,
    tipo,
    cantidad: 0,
    cantidadAnterior: 0,
    cantidadNueva: 0,
    valorMovimiento: null,
    precioCostoUnitario: null,
    costoManoObra: null,
    observaciones: null,
    creadoEn: new Date('2026-05-10T00:00:00Z'),
    sede: { id: 's1', nombre: 'Sede 1' },
    productoStock: {
      id: `sc-${v.id}`,
      precioCosto: null,
      producto: null,
      variante: {
        id: v.id,
        nombre: v.nombre,
        codigoEmpresa: v.codigo,
        unidadMedida: v.um,
        producto: { id: v.baseId, nombre: v.baseNombre, unidadMedida: v.baseUm },
      },
    },
    ...over,
  });

  const mkDetalleService = (opts: { movimientos: any[]; compras?: any[] }) => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'pf' }) },
      movimientoStock: {
        findMany: jest.fn().mockResolvedValue(opts.movimientos),
      },
      compraDetalle: {
        findMany: jest.fn().mockResolvedValue(opts.compras ?? []),
      },
    };
    const service = new ProductoComponenteService(prisma as any, {} as any);
    return { service, prisma };
  };

  it('insumo base: resuelve nombre/código/unidad del producto y última compra por productoId', async () => {
    const entrada = movBase(
      'PRODUCCION_ENTRADA',
      { cantidad: 3, cantidadAnterior: 0, cantidadNueva: 3, costoManoObra: 0 },
      { id: 'pf', nombre: 'Peluche', codigo: 'PF1', um: um('und') },
    );
    const salida = movBase(
      'PRODUCCION_SALIDA',
      {
        cantidad: -6,
        cantidadAnterior: 100,
        cantidadNueva: 94,
        valorMovimiento: 12,
        precioCostoUnitario: 2,
      },
      { id: 'hilo', nombre: 'Hilo', codigo: 'H1', um: um('und') },
    );
    const { service, prisma } = mkDetalleService({
      movimientos: [entrada, salida],
      compras: [
        {
          productoId: 'hilo',
          varianteId: null,
          cantidad: 10,
          precioUnitario: 2,
          compra: {
            creadoEn: new Date('2026-05-01T00:00:00Z'),
            fechaRecepcion: null,
            proveedor: { nombre: 'Prov A' },
          },
        },
      ],
    });

    const r = await service.detalleFabricacion('e1', 'pf', 'PROD-1');

    expect(r.productoFinal).toMatchObject({
      id: 'pf',
      varianteId: null,
      nombre: 'Peluche',
    });
    const ins = r.insumosConsumidos[0];
    expect(ins).toMatchObject({
      id: 'hilo',
      varianteId: null,
      nombre: 'Hilo',
      codigo: 'H1',
      unidadMedida: 'und',
      cantidadConsumida: 6,
    });
    expect(ins.ultimaCompra).toMatchObject({ proveedor: 'Prov A', total: 20 });
    expect(r.costoInsumos).toBe(12);
    // La compra base se busca con varianteId NULL + productoId.
    const whereArg = prisma.compraDetalle.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(whereArg.OR)).toContain('hilo');
  });

  it('insumo-variante: resuelve nombre/código/unidad desde la VARIANTE (con fallback de unidad al base) y última compra por varianteId', async () => {
    // Producto final ES una variante (talla L). Insumo consumido ES la variante
    // "T20 Niño" de "Planta" (su unidad cae al base porque la variante no la fija).
    const entrada = movVar(
      'PRODUCCION_ENTRADA',
      { cantidad: 3, cantidadAnterior: 0, cantidadNueva: 3, costoManoObra: 0 },
      {
        id: 'tallaL',
        nombre: 'Talla L',
        codigo: 'PF-L',
        um: null,
        baseId: 'pf',
        baseNombre: 'Peluche',
        baseUm: um('und'),
      },
    );
    const salida = movVar(
      'PRODUCCION_SALIDA',
      {
        cantidad: -6,
        cantidadAnterior: 50,
        cantidadNueva: 44,
        valorMovimiento: 42,
        precioCostoUnitario: 7,
      },
      {
        id: 'plantaT20',
        nombre: 'T20 Niño',
        codigo: 'PL-T20',
        um: null, // la variante no fija unidad → cae al base
        baseId: 'planta',
        baseNombre: 'Planta',
        baseUm: um('g'),
      },
    );
    const { service, prisma } = mkDetalleService({
      movimientos: [entrada, salida],
      compras: [
        {
          productoId: 'planta',
          varianteId: 'plantaT20',
          cantidad: 5,
          precioUnitario: 7,
          compra: {
            creadoEn: new Date('2026-05-01T00:00:00Z'),
            fechaRecepcion: null,
            proveedor: { nombre: 'Vivero' },
          },
        },
      ],
    });

    const r = await service.detalleFabricacion('e1', 'pf', 'PROD-2');

    // Header del producto final (variante) resuelto: "base — variante".
    expect(r.productoFinal).toMatchObject({
      id: 'pf',
      varianteId: 'tallaL',
      nombre: 'Peluche — Talla L',
    });
    const ins = r.insumosConsumidos[0];
    // Antes del fix: nombre/codigo eran null, unidadMedida '' y ultimaCompra null.
    expect(ins.id).toBe('planta');
    expect(ins.varianteId).toBe('plantaT20');
    expect(ins.nombre).toBe('Planta — T20 Niño');
    expect(ins.codigo).toBe('PL-T20');
    expect(ins.unidadMedida).toBe('g'); // fallback a la unidad del producto base
    expect(ins.cantidadConsumida).toBe(6);
    expect(ins.ultimaCompra).toMatchObject({
      proveedor: 'Vivero',
      precioUnitario: 7,
      total: 35,
    });
    expect(r.costoInsumos).toBe(42);
    // La última compra del insumo-variante se busca por varianteId.
    const whereArg = prisma.compraDetalle.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(whereArg.OR)).toContain('plantaT20');
  });
});
