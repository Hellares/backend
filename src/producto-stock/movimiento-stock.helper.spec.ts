import { Prisma } from '@prisma/client';
import { crearLoteDeEntrada } from './lote-consumo.helper';
import {
  crearMovimientoStockConValoracion,
  type CrearMovimientoStockData,
} from './movimiento-stock.helper';

jest.mock('./lote-consumo.helper');

/**
 * Candado del enganche entre el kardex y los lotes.
 *
 * La invariante es `Σ lotes presentes = stockActual`: toda entrada que sube el
 * stock tiene que dejar su lote. Lo que se fija acá es QUIÉN lo crea, porque
 * la entrada de una compra y un ajuste manual pueden llegar con el mismo tipo.
 */
describe('crearMovimientoStockConValoracion → lotes', () => {
  const motorOriginal = process.env.LOTES_FEFO_ENABLED;
  let tx: any;

  const entrada = (
    extra: Pick<CrearMovimientoStockData, 'tipo'> &
      Partial<CrearMovimientoStockData>,
  ): CrearMovimientoStockData => ({
    productoStockId: 'ps-1',
    empresaId: 'emp-1',
    sedeId: 'sede-1',
    cantidadAnterior: 3,
    cantidad: 5,
    cantidadNueva: 8,
    usuarioId: 'usr-1',
    ...extra,
  });

  beforeEach(() => {
    process.env.LOTES_FEFO_ENABLED = 'true';
    (crearLoteDeEntrada as jest.Mock).mockReset().mockResolvedValue(null);
    tx = {
      movimientoStock: {
        create: jest.fn(({ data }: any) =>
          Promise.resolve({
            id: 'mov-1',
            ventaId: null,
            transferenciaId: null,
            motivo: null,
            ...data,
          }),
        ),
      },
      productoStock: {
        findUnique: jest.fn().mockResolvedValue({
          productoId: 'prod-1',
          varianteId: null,
          precioCosto: new Prisma.Decimal(12),
        }),
      },
    };
  });

  afterAll(() => {
    if (motorOriginal === undefined) delete process.env.LOTES_FEFO_ENABLED;
    else process.env.LOTES_FEFO_ENABLED = motorOriginal;
  });

  it('🔴 un AJUSTE manual con tipo ENTRADA_COMPRA —sin compra detrás— crea su lote', async () => {
    // Antes el helper salteaba todo ENTRADA_COMPRA creyendo que la compra
    // creaba el lote: el stock subía y el lote no. JAYLI lo usó 10 veces en
    // septiembre, porque el diálogo del app lo traía elegido.
    await crearMovimientoStockConValoracion(tx, entrada({ tipo: 'ENTRADA_COMPRA' }));

    expect(crearLoteDeEntrada).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        productoStockId: 'ps-1',
        cantidad: 5,
        codigo: 'AJU-mov-1',
      }),
    );
  });

  it('la entrada de una COMPRA no crea un segundo lote: la compra declara que administra el suyo', async () => {
    await crearMovimientoStockConValoracion(
      tx,
      entrada({
        tipo: 'ENTRADA_COMPRA',
        compraId: 'compra-1',
        lotesGestionadosPorElLlamador: true,
      }),
    );

    expect(crearLoteDeEntrada).not.toHaveBeenCalled();
    // El flag es del helper, no una columna: si llegara al `create`, Prisma lo
    // rechazaría y la compra no se podría confirmar.
    const { data } = tx.movimientoStock.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('lotesGestionadosPorElLlamador');
    expect(data.compraId).toBe('compra-1');
  });

  it('con el motor apagado no toca ningún lote', async () => {
    delete process.env.LOTES_FEFO_ENABLED;

    await crearMovimientoStockConValoracion(tx, entrada({ tipo: 'AJUSTE_ENTRADA' }));

    expect(tx.movimientoStock.create).toHaveBeenCalled();
    expect(crearLoteDeEntrada).not.toHaveBeenCalled();
  });
});
