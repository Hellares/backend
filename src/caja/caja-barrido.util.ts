import { MetodoPagoVenta } from '@prisma/client';

/** Banco de recaudación mapeado a un método (o null/undefined si no hay). */
export interface BancoRecaudacionRef {
  id: string;
  isActive: boolean;
  moneda: string | null;
}

/**
 * Decide a dónde va el dinero de un método al cerrar caja (barrido):
 *  - EFECTIVO → siempre TESORERIA (bóveda, Caja Central).
 *  - Digital con cuenta de recaudación activa y en PEN → BANCO (incrementa saldo).
 *  - Cualquier otro caso (sin mapeo, banco inactivo o en otra moneda) → TESORERIA
 *    (fallback seguro: nunca se pierde el dinero).
 * La caja/tesorería son en soles, por eso un banco no-PEN cae a tesorería.
 */
export function destinoBarrido(
  metodo: MetodoPagoVenta,
  banco: BancoRecaudacionRef | null | undefined,
): 'BANCO' | 'TESORERIA' {
  if (metodo === MetodoPagoVenta.EFECTIVO) return 'TESORERIA';
  if (banco && banco.isActive && (banco.moneda ?? 'PEN') === 'PEN') return 'BANCO';
  return 'TESORERIA';
}
