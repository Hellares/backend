import { stockDisponible } from '../ia/tools/stock.util';

/**
 * Campos de ProductoStock que hacen falta para saber cuánto se puede vender.
 * `stockActual` solo no alcanza: incluye lo dañado, lo que está en garantía y
 * lo reservado, y la tienda ofrecía "+" en productos que no se podían comprar.
 */
export const STOCK_VENDIBLE = {
  stockActual: true,
  stockReservado: true,
  stockReservadoVenta: true,
  stockReservadoCombo: true,
  stockReservadoCotizacion: true,
  stockDanado: true,
  stockEnGarantia: true,
} as const;

/** Unidades vendibles de una fila (0 si no hay fila o da negativo). */
export function vendible(s: any): number {
  return s ? Math.max(0, stockDisponible(s)) : 0;
}
