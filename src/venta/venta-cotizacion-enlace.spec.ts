import { VentaService } from './venta.service';
import { EstadoVenta, EstadoCotizacion } from '@prisma/client';

/**
 * El enlace cotización ↔ venta está escrito por los DOS lados, y eso NO es una
 * duplicación: son dos hechos distintos.
 *
 *   Venta.cotizacionId  → de dónde SALIÓ la venta. Histórico, sobrevive la
 *                         anulación.
 *   Cotizacion.ventaId  → qué venta la consume AHORA. Se limpia al anular para
 *                         que la cotización vuelva a ser convertible, y sostiene
 *                         el candado anti doble conversión.
 *
 * Estos tests existen para que nadie "limpie el duplicado". Si alguien colapsa
 * los dos campos en uno, alguno de estos tres tiene que ponerse rojo.
 */
describe('enlace cotización ↔ venta', () => {
  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  let tx: any;
  let prisma: any;
  let service: VentaService;

  const build = (deps: any = {}) => {
    prisma = {
      caja: { findFirst: jest.fn().mockResolvedValue({ id: 'caja-1' }) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      ...deps,
    };
    service = new VentaService(
      prisma, null as any, null as any, { reversarMovimientosDeOrigen: jest.fn() } as any,
      null as any, null as any, { revertirCobroPorVentaAnulada: jest.fn() } as any,
      null as any, { notifyStockCambiado: jest.fn() } as any,
      null as any, logger as any, null as any,
    );
    jest.spyOn(service as any, 'invalidateProductCache').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getInclude').mockReturnValue({});
  };

  describe('al anular una venta que vino de cotización', () => {
    beforeEach(() => {
      tx = {
        venta: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'venta-1',
            sedeId: 'sede-1',
            estado: EstadoVenta.CONFIRMADA,
            cotizacionId: 'cot-1',
            detalles: [],
            pagos: [],
          }),
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'venta-1', cotizacionId: 'cot-1', ...data }),
          ),
        },
        cotizacion: { update: jest.fn().mockResolvedValue({}) },
      };
      build();
    });

    // Sin esto la cotización queda marcada como consumida por una venta que ya
    // no existe comercialmente, y no se puede volver a convertir NUNCA.
    it('libera la cotización: ventaId a null y estado de vuelta en APROBADA', async () => {
      await service.anular('venta-1', 'emp-1', 'user-1');

      expect(tx.cotizacion.update).toHaveBeenCalledWith({
        where: { id: 'cot-1' },
        data: { estado: EstadoCotizacion.APROBADA, ventaId: null },
      });
    });

    // El otro lado es histórico: la venta anulada tiene que seguir diciendo de
    // dónde salió, o se pierde la trazabilidad en el árbol de documentos.
    it('la venta anulada CONSERVA su cotizacionId', async () => {
      await service.anular('venta-1', 'emp-1', 'user-1');

      const dataDelUpdate = tx.venta.update.mock.calls[0][0].data;
      expect(dataDelUpdate).not.toHaveProperty('cotizacionId');
      expect(dataDelUpdate.estado).toBe(EstadoVenta.ANULADA);
    });
  });

  describe('candado anti doble conversión', () => {
    it('rechaza convertir una cotización que ya tiene ventaId', async () => {
      tx = {
        cotizacion: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'cot-1',
            sedeId: 'sede-1',
            estado: EstadoCotizacion.APROBADA,
            ventaId: 'venta-previa',
            detalles: [],
          }),
          update: jest.fn(),
        },
      };
      build();

      await expect(
        service.crearDesdeCotizacion('emp-1', 'cot-1', {} as any),
      ).rejects.toThrow(/ya fue convertida a venta/i);
    });

    // El mismo caso pero con la cotización ya liberada por una anulación: acá
    // SÍ tiene que dejar convertir de nuevo, y por eso el candado no puede
    // derivarse de `Venta.cotizacionId` sin excluir las anuladas.
    it('deja pasar la validación si la cotización fue liberada (ventaId null)', async () => {
      tx = {
        cotizacion: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'cot-1',
            sedeId: 'sede-1',
            estado: EstadoCotizacion.APROBADA,
            ventaId: null,
            detalles: [],
          }),
          update: jest.fn(),
        },
      };
      build();

      // Falla más adelante por falta de mocks — lo que importa es que NO sea
      // el candado el que corta.
      await expect(
        service.crearDesdeCotizacion('emp-1', 'cot-1', {} as any),
      ).rejects.not.toThrow(/ya fue convertida a venta/i);
    });
  });
});
