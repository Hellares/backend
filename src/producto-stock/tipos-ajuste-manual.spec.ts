import { TipoMovimientoStock } from '@prisma/client';
import {
  validarAjusteManual,
  validarLoteDeSalida,
  type LoteElegidoParaSalida,
} from './tipos-ajuste-manual';

/**
 * Candado del ajuste manual de stock: qué tipos entran y con qué signo.
 *
 * Los casos "en uso" salen de prod (13-09-2026, toda la historia): son los
 * tipos que de verdad llegan por `PUT producto-stock/:id/ajustar`, desde los
 * clientes actuales Y desde el APK que ya está instalado.
 */
describe('Ajuste manual de stock', () => {
  it('🔑 lo que mandan los clientes en uso sigue pasando', () => {
    const enUso: Array<[TipoMovimientoStock, number]> = [
      ['AJUSTE_ENTRADA', 5], // diálogo web, alta rápida
      ['AJUSTE_SALIDA', -5],
      ['ENTRADA_AJUSTE', 5], // stock inicial del app
      ['SALIDA_AJUSTE', -5],
      // Pantalla de merma y pérdida del app
      ['AJUSTE_MERMA', -1],
      ['AJUSTE_PERDIDA', -1],
      ['SALIDA_BAJA', -1],
      ['SALIDA_DONACION', -1],
    ];
    for (const [tipo, cantidad] of enUso) {
      expect(validarAjusteManual(tipo, cantidad)).toBeNull();
    }
  });

  it('🔴 ENTRADA_COMPRA se sigue aceptando: el APK instalado lo trae elegido por defecto', () => {
    expect(validarAjusteManual('ENTRADA_COMPRA', 12)).toBeNull();
  });

  it('lo que tiene su propio flujo se rechaza', () => {
    const conFlujoPropio: TipoMovimientoStock[] = [
      'RESERVA_VENTA',
      'LIBERAR_RESERVA_VENTA',
      'RESERVA_COMBO',
      'SALIDA_VENTA',
      'AJUSTE_SALIDA_VENTA',
      'ENTRADA_DEVOLUCION_CLIENTE',
      'ENTRADA_TRANSFERENCIA',
      'SALIDA_TRANSFERENCIA',
      'ENTRADA_GARANTIA',
      'SALIDA_GARANTIA',
      'RETORNO_GARANTIA',
      'AJUSTE_REPARACION',
      'PRODUCCION_ENTRADA',
      'PRODUCCION_SALIDA',
      'SALIDA_DEVOLUCION_PROVEEDOR',
      'SALIDA_SORTEO',
    ];
    for (const tipo of conFlujoPropio) {
      expect(validarAjusteManual(tipo, tipo.startsWith('SALIDA') ? -1 : 1)).toMatch(
        /propio módulo/,
      );
    }
  });

  it('el signo tiene que coincidir con el tipo', () => {
    // Una merma POSITIVA crearía un lote de ajuste con stock que no existe.
    expect(validarAjusteManual('AJUSTE_MERMA', 3)).toMatch(/salida/);
    expect(validarAjusteManual('AJUSTE_ENTRADA', -3)).toMatch(/entrada/);
    expect(validarAjusteManual('AJUSTE_ENTRADA', 0)).toMatch(/no puede ser 0/);
  });

  describe('salida de un lote ELEGIDO', () => {
    const lote = (extra: Partial<LoteElegidoParaSalida> = {}) => ({
      productoStockId: 'ps-1',
      codigo: 'APERTURA-1',
      estado: 'ACTIVO',
      cantidadActual: 3,
      ...extra,
    });

    it('sale del lote si alcanza, incluso uno VENCIDO (la merma de lo vencido es el caso típico)', () => {
      expect(validarLoteDeSalida(lote(), 'ps-1', -3)).toBeNull();
      expect(validarLoteDeSalida(lote({ estado: 'VENCIDO' }), 'ps-1', -1)).toBeNull();
    });

    it('🔴 si el lote no alcanza se rechaza: NO se reparte el resto a otro lote', () => {
      // La prueba del 13-09 en beta: una salida de 5 tomó 3 de APERTURA y 2
      // de otro lote. Si el usuario eligió el lote, el resto no puede salir
      // de uno que no eligió.
      expect(validarLoteDeSalida(lote(), 'ps-1', -5)).toMatch(
        /APERTURA-1 tiene 3 unidades: no alcanza para 5/,
      );
    });

    it('el lote tiene que ser de ESE stock (otro producto u otra sede no)', () => {
      expect(validarLoteDeSalida(lote({ productoStockId: 'ps-2' }), 'ps-1', -1)).toMatch(
        /no es de este producto/,
      );
      expect(validarLoteDeSalida(null, 'ps-1', -1)).toMatch(/no es de este producto/);
    });

    it('un lote AGOTADO o sin mercadería no se puede elegir', () => {
      expect(validarLoteDeSalida(lote({ estado: 'AGOTADO', cantidadActual: 0 }), 'ps-1', -1)).toMatch(
        /ya no tiene mercadería/,
      );
    });

    it('en una entrada no se elige lote: la entrada crea el suyo', () => {
      expect(validarLoteDeSalida(lote(), 'ps-1', 2)).toMatch(/solo se elige en una salida/);
    });
  });
});
