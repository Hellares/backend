import { BadRequestException } from '@nestjs/common';

jest.mock('../producto-stock/movimiento-stock.helper', () => ({
  crearMovimientoStockConValoracion: jest.fn(),
  lotesActivos: jest.fn(() => true),
}));
jest.mock('../producto-stock/lote-consumo.helper', () => ({
  crearLoteDeEntrada: jest.fn(),
  heredarLotesDeSalida: jest.fn(),
  registrarAsignaciones: jest.fn(),
}));

import {
  crearMovimientoStockConValoracion,
} from '../producto-stock/movimiento-stock.helper';
import {
  crearLoteDeEntrada,
  heredarLotesDeSalida,
  registrarAsignaciones,
} from '../producto-stock/lote-consumo.helper';
import { CLAVE_ATRIBUTO_DISENO, VarianteDisenoService } from './variante-diseno.service';

/**
 * Separar una variante por diseño. Se mockea Prisma y los helpers de kardex y
 * lotes: lo que se verifica es la ORQUESTACIÓN —cuánto sale de dónde, a qué
 * variante entra, con qué nombre y que los lotes se hereden de la salida—. La
 * prueba contra una base real se hace en beta.
 */
describe('VarianteDisenoService.separar', () => {
  const ATR = {
    tam: { id: 'a-tam', clave: 'tamano', orden: 1, usarEnNombreVariante: true },
    col: { id: 'a-col', clave: 'dise_o', orden: 5, usarEnNombreVariante: true },
  };
  const ATR_DISENO = { id: 'a-dis', orden: 9, isActive: true };

  const origenBase = () => ({
    id: 'v-kitty',
    productoId: 'p1',
    empresaId: 'e1',
    nombre: '2 PLAZAS / KITTY',
    sku: 'EDR-KITTY',
    unidadMedidaId: null,
    unidadPresentacionId: null,
    factorPresentacion: null,
    peso: null,
    dimensiones: null,
    orden: 3,
    atributosValores: [
      { atributoId: ATR.tam.id, valor: '2 PLAZAS', atributo: ATR.tam },
      { atributoId: ATR.col.id, valor: 'KITTY', atributo: ATR.col },
    ],
    preciosNivel: [
      {
        nombre: 'Por mayor',
        cantidadMinima: 3,
        cantidadMaxima: null,
        tipoPrecio: 'PRECIO_FIJO',
        precio: 80,
        porcentajeDesc: null,
        descripcion: null,
        orden: 0,
      },
    ],
    archivos: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
  });

  const stockSede = (over: Record<string, unknown> = {}) => ({
    id: 'ps-origen',
    sedeId: 's1',
    stockActual: 10,
    stockReservado: 0,
    stockReservadoVenta: 0,
    stockReservadoCombo: 0,
    stockReservadoCotizacion: 0,
    stockDanado: 0,
    stockEnGarantia: 0,
    ubicacion: null,
    precio: 120,
    precioCosto: 60,
    precioOferta: null,
    enOferta: false,
    fechaInicioOferta: null,
    fechaFinOferta: null,
    precioConfigurado: true,
    precioIncluyeIgv: true,
    envioGratis: false,
    ...over,
  });

  function montar(opts: {
    origen?: ReturnType<typeof origenBase>;
    stocks?: ReturnType<typeof stockSede>[];
    hermanas?: Array<{ atributosValores: Array<{ atributoId: string; valor: string }> }>;
  } = {}) {
    const origen = opts.origen ?? origenBase();
    const stocks = opts.stocks ?? [stockSede()];
    let nVar = 0;
    let nStock = 0;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(stocks.map((s) => ({ id: s.id, sedeId: s.sedeId }))),
      productoStock: {
        findMany: jest.fn().mockResolvedValue(stocks),
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `ps-nuevo-${++nStock}` })),
        update: jest.fn().mockResolvedValue({}),
      },
      productoVariante: {
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `v-nueva-${++nVar}` })),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      productoAtributoValor: { createMany: jest.fn().mockResolvedValue({}) },
      precioNivel: { createMany: jest.fn().mockResolvedValue({}) },
      archivo: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      productoVariante: {
        findFirst: jest.fn().mockResolvedValue(origen),
        findMany: jest.fn().mockResolvedValue(opts.hermanas ?? []),
      },
      productoAtributo: {
        findUnique: jest.fn().mockResolvedValue(ATR_DISENO),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new VarianteDisenoService(
      prisma as any,
      { invalidateProductosLists: jest.fn() } as any,
      { notifyProductoActualizado: jest.fn() } as any,
      { generarCodigoVariante: jest.fn().mockResolvedValue({ codigoEmpresa: 'VAR-1' }) } as any,
      { recalcularProducto: jest.fn() } as any,
    );
    return { service, tx, prisma };
  }

  let movId = 0;
  beforeEach(() => {
    jest.clearAllMocks();
    movId = 0;
    (crearMovimientoStockConValoracion as jest.Mock).mockImplementation(() =>
      Promise.resolve({ id: `mov-${++movId}` }),
    );
    (heredarLotesDeSalida as jest.Mock).mockImplementation((_tx, _sal, cantidad) =>
      Promise.resolve({
        asignaciones: [{ loteId: 'lote-h', cantidad: -cantidad, costoUnitario: 60 }],
        sinCubrir: 0,
      }),
    );
  });

  it('crea un diseño por foto, con su stock, su nombre D1/D2 y sus lotes heredados', async () => {
    const { service, tx } = montar();

    const r = await service.separar(
      'e1',
      'v-kitty',
      { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }, { archivoId: 'f2', cantidad: 3 }] },
      'u1',
    );

    expect(r.disenos).toEqual([
      { id: 'v-nueva-1', nombre: '2 PLAZAS / KITTY / D1', cantidad: 1 },
      { id: 'v-nueva-2', nombre: '2 PLAZAS / KITTY / D2', cantidad: 3 },
    ]);
    expect(r.stockRestante).toBe(6);
    expect(r.origenDesactivada).toBe(false);

    // SKU derivado de la original, atributos copiados + el diseño.
    expect(tx.productoVariante.create.mock.calls[0][0].data).toMatchObject({
      sku: 'EDR-KITTY-D1',
      productoId: 'p1',
      orden: 3,
    });
    expect(tx.productoAtributoValor.createMany.mock.calls[1][0].data).toEqual([
      { varianteId: 'v-nueva-2', atributoId: ATR.tam.id, valor: '2 PLAZAS' },
      { varianteId: 'v-nueva-2', atributoId: ATR.col.id, valor: 'KITTY' },
      { varianteId: 'v-nueva-2', atributoId: ATR_DISENO.id, valor: 'D2' },
    ]);

    // La foto se muda a su diseño.
    expect(tx.archivo.update).toHaveBeenCalledWith({
      where: { id: 'f2' },
      data: expect.objectContaining({ varianteId: 'v-nueva-2', entidadId: 'v-nueva-2' }),
    });

    // Precio y costo de la sede copiados; precio por mayor también.
    expect(tx.productoStock.create.mock.calls[0][0].data).toMatchObject({
      varianteId: 'v-nueva-1',
      stockActual: 0,
      precio: 120,
      precioCosto: 60,
    });
    expect(tx.precioNivel.createMany).toHaveBeenCalledTimes(2);

    // Kardex: salida de la original encadenada (10→9→6) y entrada al diseño.
    const movs = (crearMovimientoStockConValoracion as jest.Mock).mock.calls.map((c) => c[1]);
    expect(movs.map((m) => [m.productoStockId, m.tipo, m.cantidad, m.cantidadAnterior, m.cantidadNueva])).toEqual([
      ['ps-origen', 'PRODUCCION_SALIDA', -1, 10, 9],
      ['ps-nuevo-1', 'PRODUCCION_ENTRADA', 1, 0, 1],
      ['ps-origen', 'PRODUCCION_SALIDA', -3, 9, 6],
      ['ps-nuevo-2', 'PRODUCCION_ENTRADA', 3, 0, 3],
    ]);
    // La entrada NO deja que el helper cree lotes: los hereda de su salida.
    expect(movs[1].lotesGestionadosPorElLlamador).toBe(true);
    expect(movs[0].lotesGestionadosPorElLlamador).toBeUndefined();
    expect((heredarLotesDeSalida as jest.Mock).mock.calls[1][1]).toBe('mov-3');
    expect(registrarAsignaciones).toHaveBeenCalledWith(tx, 'mov-4', [
      { loteId: 'lote-h', cantidad: -3, costoUnitario: 60 },
    ]);
    expect(crearLoteDeEntrada).not.toHaveBeenCalled();

    // Stocks finales.
    expect(tx.productoStock.update).toHaveBeenCalledWith({ where: { id: 'ps-nuevo-2' }, data: { stockActual: 3 } });
    expect(tx.productoStock.update).toHaveBeenLastCalledWith({ where: { id: 'ps-origen' }, data: { stockActual: 6 } });
  });

  it('si reparte TODO, la original se desactiva', async () => {
    const { service, tx } = montar({ stocks: [stockSede({ stockActual: 2 })] });
    const r = await service.separar(
      'e1',
      'v-kitty',
      { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }, { archivoId: 'f3', cantidad: 1 }] },
      'u1',
    );
    expect(r.origenDesactivada).toBe(true);
    expect(tx.productoVariante.update).toHaveBeenCalledWith({ where: { id: 'v-kitty' }, data: { isActive: false } });
  });

  it('sigue la numeración de la colección (llegó mercadería: D8, no D1)', async () => {
    const { service } = montar({
      hermanas: [
        // Misma colección: cuenta.
        { atributosValores: [{ atributoId: ATR.tam.id, valor: '2 plazas' }, { atributoId: ATR.col.id, valor: 'KITTY' }, { atributoId: ATR_DISENO.id, valor: 'D7' }] },
        // Otra colección: no cuenta.
        { atributosValores: [{ atributoId: ATR.tam.id, valor: '2 PLAZAS' }, { atributoId: ATR.col.id, valor: 'ALIANZA' }, { atributoId: ATR_DISENO.id, valor: 'D20' }] },
      ],
    });
    const r = await service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }] }, 'u1');
    expect(r.disenos[0].nombre).toBe('2 PLAZAS / KITTY / D8');
  });

  it('un nombre puesto a mano se respeta y se le agrega el diseño', async () => {
    const origen = { ...origenBase(), nombre: 'Kitty rosado edición especial' };
    const { service } = montar({ origen });
    const r = await service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }] }, 'u1');
    expect(r.disenos[0].nombre).toBe('Kitty rosado edición especial / D1');
  });

  it('las unidades sin lote que heredar entran con un lote de ajuste', async () => {
    (heredarLotesDeSalida as jest.Mock).mockResolvedValueOnce({ asignaciones: [], sinCubrir: 2 });
    (crearLoteDeEntrada as jest.Mock).mockResolvedValueOnce({ loteId: 'aju', cantidad: -2, costoUnitario: 60 });
    const { service } = montar();
    await service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 2 }] }, 'u1');
    expect((crearLoteDeEntrada as jest.Mock).mock.calls[0][1]).toMatchObject({
      productoStockId: 'ps-nuevo-1',
      varianteId: 'v-nueva-1',
      cantidad: 2,
      codigo: 'AJU-mov-2',
    });
  });

  describe('rechaza', () => {
    const esperaError = async (p: Promise<unknown>, texto: RegExp) => {
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await p.catch((e: BadRequestException) => {
        const resp = e.getResponse() as { message: string };
        expect(resp.message).toMatch(texto);
      });
    };

    it('más unidades que el disponible (reservas y dañados no cuentan)', async () => {
      const { service, tx } = montar({ stocks: [stockSede({ stockActual: 5, stockDanado: 1, stockReservadoVenta: 1 })] });
      await esperaError(
        service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 2 }, { archivoId: 'f2', cantidad: 2 }] }, 'u1'),
        /Asignaste 4 unidades y hay 3/,
      );
      expect(tx.productoVariante.create).not.toHaveBeenCalled();
    });

    it('una foto que no es de la variante', async () => {
      const { service } = montar();
      await esperaError(
        service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'ajena', cantidad: 1 }] }, 'u1'),
        /no pertenece a esta variante/,
      );
    });

    it('la misma foto dos veces', async () => {
      const { service } = montar();
      await esperaError(
        service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }, { archivoId: 'f1', cantidad: 1 }] }, 'u1'),
        /foto repetida/,
      );
    });

    it('separar algo que ya es un diseño', async () => {
      const origen = origenBase();
      origen.atributosValores.push({
        atributoId: ATR_DISENO.id,
        valor: 'D1',
        atributo: { id: ATR_DISENO.id, clave: CLAVE_ATRIBUTO_DISENO, orden: 9, usarEnNombreVariante: true },
      });
      const { service } = montar({ origen });
      await esperaError(
        service.separar('e1', 'v-kitty', { sedeId: 's1', disenos: [{ archivoId: 'f1', cantidad: 1 }] }, 'u1'),
        /ya es un diseño/,
      );
    });

    it('una sede donde la variante no tiene stock', async () => {
      const { service } = montar();
      await esperaError(
        service.separar('e1', 'v-kitty', { sedeId: 'otra', disenos: [{ archivoId: 'f1', cantidad: 1 }] }, 'u1'),
        /no tiene stock registrado en esa sede/,
      );
    });
  });
});
