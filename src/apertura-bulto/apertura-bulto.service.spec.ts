import { AperturaBultoService } from './apertura-bulto.service';

/**
 * Tests de la apertura de bultos — saco cerrado ↔ granel.
 *
 * Foco en el COSTO, que es donde esto se rompe en silencio: mueve valor entre
 * dos stocks por promedio ponderado y con unidades atómicas chicas (gramos),
 * justo el terreno donde redondear a centavos infla el costo un 47%.
 *
 * Prisma y cache van mockeados; `$transaction` ejecuta el callback con un `tx`
 * mockeado, igual que producto-componente.service.spec.
 */
jest.mock('../producto-stock/movimiento-stock.helper', () => ({
  crearMovimientoStockConValoracion: jest.fn().mockResolvedValue({}),
}));
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';

const movMock = crearMovimientoStockConValoracion as jest.Mock;

const SACO = 'v-saco';
const GRANEL = 'v-granel';

/** Fila de ProductoStock como la devuelve el $queryRaw FOR UPDATE. */
const fila = (varianteId: string, stockActual: number, precioCosto: string | null) => ({
  id: `st-${varianteId}`,
  varianteId,
  stockActual,
  precioCosto,
});

const mkService = (opts: {
  variante?: any;
  filas?: any[];
  esGerente?: boolean;
}) => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(opts.filas ?? []),
    productoStock: { update: jest.fn().mockResolvedValue({}) },
    productoPrecioHistorialSede: { create: jest.fn().mockResolvedValue({}) },
  };
  const rol = opts.esGerente === false ? null : { id: 'r1' };
  const prisma = {
    productoVariante: {
      findFirst: jest.fn().mockResolvedValue(
        opts.variante ?? {
          id: SACO,
          nombre: 'SACO 15KG',
          productoId: 'p1',
          varianteAperturaId: GRANEL,
          rendimientoApertura: 15000,
          producto: { nombre: 'ALIMENTO PERRO' },
          varianteApertura: { id: GRANEL, nombre: 'GRANEL', isActive: true, deletedAt: null },
        },
      ),
    },
    empresaUsuarioRol: { findFirst: jest.fn().mockResolvedValue(rol) },
    usuarioSedeRol: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const cache = { invalidateProductosLists: jest.fn().mockResolvedValue(undefined) };
  const realtime = { notifyStockCambiado: jest.fn() };
  const service = new AperturaBultoService(
    prisma as any,
    cache as any,
    realtime as any,
  );
  return { service, prisma, tx, realtime };
};

const DTO = (cantidad = 1) => ({ varianteId: SACO, sedeId: 's1', cantidad });

const updateDe = (tx: any, stockId: string) =>
  tx.productoStock.update.mock.calls.find((c: any[]) => c[0].where.id === stockId);

beforeEach(() => movMock.mockClear());

describe('AperturaBultoService.abrir', () => {
  it('mueve el stock: 1 saco de 15 000 g sale del saco y entra al granel', async () => {
    const { service, tx } = mkService({
      filas: [fila(SACO, 5, '150'), fila(GRANEL, 0, null)],
    });

    const r = await service.abrir('e1', DTO(1), 'u1');

    expect(updateDe(tx, `st-${SACO}`)![0].data.stockActual).toBe(4);
    expect(updateDe(tx, `st-${GRANEL}`)![0].data.stockActual).toBe(15000);
    expect(r.bultos).toBe(1);
    expect(r.unidadesPorBulto).toBe(15000);
    expect(r.numeroDocumento).toMatch(/^APER-/);
  });

  it('🔴 avisa por realtime del stock de LAS DOS variantes', async () => {
    // Sin esto los devices con el catálogo ya cargado siguen viendo el granel
    // en cero, y como el sheet de venta esconde los valores sin stock, el
    // granel recién abierto no aparece para vender. Invalidar Redis no
    // alcanza: arregla la próxima consulta, no la copia que el POS ya tiene.
    const { service, realtime } = mkService({
      filas: [fila(SACO, 5, '150'), fila(GRANEL, 0, null)],
    });

    await service.abrir('e1', DTO(1), 'u1');

    const variantesAvisadas = realtime.notifyStockCambiado.mock.calls.map(
      (c: any[]) => c[0].varianteId,
    );
    expect(variantesAvisadas).toEqual([SACO, GRANEL]);
    expect(realtime.notifyStockCambiado.mock.calls[0][0]).toMatchObject({
      empresaId: 'e1',
      productoId: 'p1',
      sedeId: 's1',
    });
  });

  it('🔴 el costo por gramo NO se redondea a centavos', async () => {
    // Saco a S/150 que rinde 15 000 g → 0.01/g exacto sería casualidad; se usa
    // un rendimiento de 22 000 para que dé 0.006818, el caso que rompía.
    const { service, tx } = mkService({
      variante: {
        id: SACO,
        nombre: 'SACO 22KG',
        productoId: 'p1',
        varianteAperturaId: GRANEL,
        rendimientoApertura: 22000,
        producto: { nombre: 'RICOCAN' },
        varianteApertura: { id: GRANEL, nombre: 'GRANEL', isActive: true, deletedAt: null },
      },
      filas: [fila(SACO, 3, '150'), fila(GRANEL, 0, null)],
    });

    const r = await service.abrir('e1', DTO(1), 'u1');

    expect(r.destino.precioCostoNuevo).toBe(0.006818);
    expect(r.destino.precioCostoNuevo).not.toBe(0.01);
    expect(updateDe(tx, `st-${GRANEL}`)![0].data.precioCosto).toBe(0.006818);
  });

  it('promedio ponderado con granel previo a otro costo', async () => {
    // 10 000 g previos a 0.008 = 80. Entran 15 000 g de un saco de 150.
    // (80 + 150) / 25 000 = 0.0092
    const { service } = mkService({
      filas: [fila(SACO, 2, '150'), fila(GRANEL, 10000, '0.008')],
    });

    const r = await service.abrir('e1', DTO(1), 'u1');

    expect(r.destino.stockNuevo).toBe(25000);
    expect(r.destino.precioCostoNuevo).toBe(0.0092);
  });

  it('valora los dos movimientos de kardex con el costo correcto', async () => {
    const { service } = mkService({
      filas: [fila(SACO, 2, '150'), fila(GRANEL, 0, null)],
    });

    await service.abrir('e1', DTO(1), 'u1');

    const salida = movMock.mock.calls.find((c) => c[1].tipo === 'PRODUCCION_SALIDA');
    const entrada = movMock.mock.calls.find((c) => c[1].tipo === 'PRODUCCION_ENTRADA');
    // El saco sale valorado a lo que costaba el saco.
    expect(salida![1].precioCostoUnitario).toBe(150);
    expect(salida![1].cantidad).toBe(-1);
    // El granel entra valorado al costo por gramo del lote: 150 / 15 000.
    expect(entrada![1].precioCostoUnitario).toBe(0.01);
    expect(entrada![1].cantidad).toBe(15000);
    // Los dos comparten el mismo numeroDocumento (misma operación).
    expect(salida![1].numeroDocumento).toBe(entrada![1].numeroDocumento);
  });

  it('sin costo en el origen no toca el costo del destino', async () => {
    const { service, tx } = mkService({
      filas: [fila(SACO, 2, null), fila(GRANEL, 5000, '0.008')],
    });

    const r = await service.abrir('e1', DTO(1), 'u1');

    expect(r.costoActualizado).toBe(false);
    expect(r.razonCostoNoActualizado).toMatch(/no tiene precio de costo/i);
    // El stock sí se mueve, pero el precioCosto del destino queda intacto.
    expect(updateDe(tx, `st-${GRANEL}`)![0].data.precioCosto).toBeUndefined();
    expect(updateDe(tx, `st-${GRANEL}`)![0].data.stockActual).toBe(20000);
  });

  it('falla si no hay bultos suficientes', async () => {
    const { service } = mkService({ filas: [fila(SACO, 1, '150'), fila(GRANEL, 0, null)] });

    await expect(service.abrir('e1', DTO(3), 'u1')).rejects.toMatchObject({
      response: { code: 'BULTOS_INSUFICIENTES' },
    });
  });

  it('falla si la variante no tiene apertura configurada', async () => {
    const { service } = mkService({
      variante: {
        id: SACO, nombre: 'SACO', productoId: 'p1',
        varianteAperturaId: null, rendimientoApertura: null,
        producto: { nombre: 'X' }, varianteApertura: null,
      },
    });

    await expect(service.abrir('e1', DTO(1), 'u1')).rejects.toMatchObject({
      response: { code: 'VARIANTE_SIN_APERTURA' },
    });
  });

  it('falla con rendimiento fraccionario (el stock es entero)', async () => {
    const { service } = mkService({
      variante: {
        id: SACO, nombre: 'SACO', productoId: 'p1',
        varianteAperturaId: GRANEL, rendimientoApertura: 15.5,
        producto: { nombre: 'X' },
        varianteApertura: { id: GRANEL, nombre: 'GRANEL', isActive: true, deletedAt: null },
      },
    });

    await expect(service.abrir('e1', DTO(1), 'u1')).rejects.toMatchObject({
      response: { code: 'RENDIMIENTO_FRACCIONARIO' },
    });
  });

  it('sin rol de gerencia no deja abrir', async () => {
    const { service } = mkService({
      esGerente: false,
      filas: [fila(SACO, 5, '150'), fila(GRANEL, 0, null)],
    });

    await expect(service.abrir('e1', DTO(1), 'u1')).rejects.toMatchObject({
      response: { code: 'APERTURA_NO_AUTORIZADA' },
    });
  });
});

describe('AperturaBultoService.cerrar', () => {
  it('devuelve el bulto y descuenta el granel', async () => {
    const { service, tx } = mkService({
      filas: [fila(SACO, 4, '150'), fila(GRANEL, 15000, '0.01')],
    });

    const r = await service.cerrar('e1', DTO(1), 'u1');

    expect(updateDe(tx, `st-${GRANEL}`)![0].data.stockActual).toBe(0);
    expect(updateDe(tx, `st-${SACO}`)![0].data.stockActual).toBe(5);
    expect(r.operacion).toBe('CERRAR');
  });

  it('🔑 al cerrar, el saco recibe el costo ACTUAL del granel, no el original', async () => {
    // El granel bajó a 0.008 (entró mercadería más barata). Rearmar un saco
    // de 15 000 g lo valoriza en 15 000 × 0.008 = 120, no en los 150 que
    // costó el saco original.
    const { service } = mkService({
      filas: [fila(SACO, 0, null), fila(GRANEL, 30000, '0.008')],
    });

    const r = await service.cerrar('e1', DTO(1), 'u1');

    expect(r.destino.precioCostoNuevo).toBe(120);
  });

  it('no se puede cerrar si no queda granel suficiente', async () => {
    // Se abrió un saco y se vendieron 3 kg: quedan 12 000 g y ese saco no vuelve.
    const { service } = mkService({
      filas: [fila(SACO, 0, null), fila(GRANEL, 12000, '0.01')],
    });

    await expect(service.cerrar('e1', DTO(1), 'u1')).rejects.toMatchObject({
      response: { code: 'GRANEL_INSUFICIENTE' },
    });
  });

  it('abrir y cerrar el mismo bulto conserva el valor total del inventario', async () => {
    // Abrir: saco 150 → 15 000 g a 0.01. Cerrar con el granel en 0.01
    // devuelve un saco a 150. El valor no se crea ni se destruye.
    const abrir = mkService({ filas: [fila(SACO, 1, '150'), fila(GRANEL, 0, null)] });
    const rA = await abrir.service.abrir('e1', DTO(1), 'u1');
    expect(rA.destino.precioCostoNuevo).toBe(0.01);

    const cerrar = mkService({
      filas: [fila(SACO, 0, null), fila(GRANEL, 15000, '0.01')],
    });
    const rC = await cerrar.service.cerrar('e1', DTO(1), 'u1');
    expect(rC.destino.precioCostoNuevo).toBe(150);
  });
});
