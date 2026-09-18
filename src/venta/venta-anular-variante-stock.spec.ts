import { VentaService } from './venta.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';

jest.mock('../producto-stock/movimiento-stock.helper');
jest.mock('../producto-stock/lote-consumo.helper');

/**
 * Anular una venta de VARIANTE tiene que devolver la mercadería.
 *
 * 🔴 El stock de una variante vive en `ProductoStock` con `productoId = NULL` y
 * `varianteId` cargado (el XOR del modelo). `anular()` lo buscaba con los dos
 * campos a la vez (`productoId: detalle.productoId ?? null` Y `varianteId`),
 * y como el detalle de la venta SÍ trae el producto padre, el where no matcheaba
 * ninguna fila. El `if (!productoStock) continue` se comía la línea EN SILENCIO:
 * la venta quedaba anulada, la plata volvía por caja y la mercadería no volvía
 * al inventario.
 *
 * Pasó en producción: VTA-SED-00000814 (16-09-2026, JAYLI, 1 edredón de
 * variante, S/ 83). De 17 anulaciones en 120 días fue la única sin reversa —
 * las otras 16 eran productos simples, que el where sí encontraba.
 *
 * Estos tests fijan el branch correcto, el mismo que ya usaban `crearYCobrar` y
 * `_eliminarVentaDiferidaPendiente`.
 */
describe('VentaService.anular — reverso de stock de una VARIANTE', () => {
  let service: VentaService;
  let prisma: any;
  let tx: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  /** @param detalle la única línea de la venta que se anula */
  const build = (detalle: Record<string, unknown>) => {
    tx = {
      venta: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'vta-1',
          sedeId: 'sede-1',
          codigo: 'VTA-SED-00000814',
          estado: 'PAGADA_COMPLETA',
          cotizacionId: null,
          detalles: [detalle],
          pagos: [],
        }),
        // Cortamos acá: el reverso de stock ya ocurrió y lo que sigue (caja)
        // no es lo que se prueba. Mismo patrón que el spec del autorizador.
        update: jest.fn().mockRejectedValue(new Error('LLEGO_AL_UPDATE')),
      },
      productoStock: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ps-1', stockActual: 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      empresaUsuarioRol: { findFirst: jest.fn().mockResolvedValue({ id: 'rol-1' }) },
      usuarioSedeRol: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any,
      null as any, logger as any, null as any,
      null as any, null as any,
    );
  };

  const anular = () =>
    service.anular('vta-1', 'emp-1', 'admin-1', {
      autorizadoPorId: 'admin-1',
      motivo: 'Error de tipeo',
    });

  beforeEach(() => jest.clearAllMocks());

  it('🔴 una línea de VARIANTE se busca SOLO por varianteId y devuelve el stock', async () => {
    build({
      id: 'det-1',
      // El detalle trae el producto padre ADEMÁS de la variante: ese es
      // justamente el dato que rompía el where.
      productoId: 'prod-edredones',
      varianteId: 'var-carnerito-cristal',
      cantidad: 1,
      descripcion: 'EDREDONES - 2 PLAZAS / CARNERITO / 3 PZS / HOMBRE / CRISTAL',
    });

    await expect(anular()).rejects.toThrow('LLEGO_AL_UPDATE');

    // Sin `productoId` en el where: con él no matchea la fila de la variante.
    expect(tx.productoStock.findFirst).toHaveBeenCalledWith({
      where: { sedeId: 'sede-1', varianteId: 'var-carnerito-cristal' },
    });
    // Y la mercadería volvió: 0 → 1.
    expect(tx.productoStock.update).toHaveBeenCalledWith({
      where: { id: 'ps-1' },
      data: { stockActual: 1 },
    });
    // Con su movimiento de reversa, que es lo que deja el kardex cuadrado.
    expect(crearMovimientoStockConValoracion).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tipo: 'AJUSTE_SALIDA_VENTA',
        cantidad: 1,
        cantidadAnterior: 0,
        cantidadNueva: 1,
        productoStockId: 'ps-1',
        ventaId: 'vta-1',
      }),
    );
  });

  it('un producto SIMPLE se sigue buscando por productoId con varianteId null', async () => {
    build({
      id: 'det-2',
      productoId: 'prod-lotso',
      varianteId: null,
      cantidad: 2,
      descripcion: 'LOTSO TE AMO 50 CM',
    });

    await expect(anular()).rejects.toThrow('LLEGO_AL_UPDATE');

    expect(tx.productoStock.findFirst).toHaveBeenCalledWith({
      where: { sedeId: 'sede-1', productoId: 'prod-lotso', varianteId: null },
    });
    expect(tx.productoStock.update).toHaveBeenCalledWith({
      where: { id: 'ps-1' },
      data: { stockActual: 2 },
    });
  });

  it('una línea de SERVICIO (sin producto ni variante) no toca stock', async () => {
    build({
      id: 'det-3',
      productoId: null,
      varianteId: null,
      cantidad: 1,
      descripcion: 'Mano de obra',
    });

    await expect(anular()).rejects.toThrow('LLEGO_AL_UPDATE');

    expect(tx.productoStock.findFirst).not.toHaveBeenCalled();
    expect(crearMovimientoStockConValoracion).not.toHaveBeenCalled();
  });
});
