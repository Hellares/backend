import { Prisma } from '@prisma/client';

/**
 * La cuenta de la deuda con el proveedor, en UN solo lugar.
 *
 * Vive suelto porque lo usan cuatro pantallas distintas (el listado de
 * compras, el detalle, la lista de CxP y el detalle de CxP) y antes cada una
 * hacia `total - suma(monto)` por su cuenta. Con compras en moneda extranjera
 * esa cuenta dejo de ser valida y equivocarla no se ve: la compra aparece
 * pagada sin estarlo.
 */

/** Decimal de Prisma o numero, indistinto. */
type Monto = Prisma.Decimal | number | null | undefined;

const num = (v: Monto): number => (v == null ? 0 : Number(v));

export interface PagoParaSaldo {
  monto: Monto;
  /** Lo que cancela en la moneda de la COMPRA. null = misma moneda que `monto`. */
  montoAplicado?: Monto;
  anulado?: boolean;
}

/**
 * Lo que un pago CANCELA de la deuda, en la moneda de la COMPRA.
 *
 * 🔴 NO es `monto`: eso es lo que sale de la fuente, en la moneda de la fuente.
 * Cuando una empresa que no maneja dolares paga una factura en dolares desde
 * su caja en soles, salen S/910.55 y cancelan US$242.49. Restarle los soles a
 * una deuda en dolares la deja pagada casi cuatro veces de mas.
 */
export function montoQueCancela(p: PagoParaSaldo): number {
  return p.montoAplicado != null ? num(p.montoAplicado) : num(p.monto);
}

/** Lo pagado de una compra, en su moneda. Los pagos anulados no cuentan. */
export function totalPagadoCompra(pagos: PagoParaSaldo[]): number {
  const suma = pagos
    .filter((p) => !p.anulado)
    .reduce((s, p) => s + montoQueCancela(p), 0);
  return Math.round(suma * 100) / 100;
}

/** Lo que falta pagarle al proveedor, en la moneda de la compra. */
export function saldoCompra(total: Monto, pagos: PagoParaSaldo[]): number {
  return Math.round((num(total) - totalPagadoCompra(pagos)) * 100) / 100;
}

/** Soles que realmente salieron de caja o banco por esta compra. */
export function totalPagadoSoles(pagos: PagoParaSaldo[]): number {
  const suma = pagos
    .filter((p) => !p.anulado)
    .reduce((s, p) => s + num(p.monto), 0);
  return Math.round(suma * 100) / 100;
}

/**
 * Diferencia de cambio: los soles que de verdad salieron contra los soles a
 * los que se reconocio la compra (`totalSoles`, congelado a su tipo de cambio).
 *
 * Positivo = se pago MAS caro en soles de lo que costo el dia de la compra
 * (perdida por diferencia de cambio); negativo = se pago menos (ganancia).
 *
 * 🔴 Es un dato DERIVADO y no se registra en ningun lado: la plata real ya
 * esta en la caja dentro de los pagos, y anotarla otra vez seria contarla dos
 * veces. Tampoco toca el costo del inventario, que quedo congelado al tipo de
 * cambio del dia en que la mercaderia entro.
 *
 * Solo tiene sentido con la compra PAGADA: mientras falte plata, la brecha es
 * lo que falta pagar, no una diferencia de cambio. Devuelve 0 si no se cancelo
 * todo.
 */
export function diferenciaDeCambio(
  total: Monto,
  totalSoles: Monto,
  pagos: PagoParaSaldo[],
): number {
  if (saldoCompra(total, pagos) > 0) return 0;
  return Math.round((totalPagadoSoles(pagos) - num(totalSoles)) * 100) / 100;
}
