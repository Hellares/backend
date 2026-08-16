import { round2 } from './money.util';

export interface EntradaMontosLinea {
  cantidad: number;
  precioUnitario: number;
  descuento?: number;
  /** Porcentaje de IGV de la línea (18 por defecto). */
  porcentajeIGV?: number;
  /** El precio ya trae el IGV adentro y hay que extraerlo. */
  precioIncluyeIgv?: boolean;
  /** Impuesto a la bolsa plástica, se suma al total sin pasar por el IGV. */
  icbper?: number;
}

export interface MontosLinea {
  /** Base imponible. */
  subtotal: number;
  igv: number;
  /** Lo que paga el cliente por esta línea. `subtotal + igv + icbper`. */
  total: number;
  icbper: number;
}

/**
 * Los tres montos de una línea de venta, **cuadrados entre sí**.
 *
 * 🔴 La regla es que `subtotal + igv + icbper === total`, SIEMPRE. Antes cada
 * uno se redondeaba por su cuenta y en cuanto el total crudo caía entre
 * centavos las partes dejaban de sumar:
 *
 *     1237 g × 0.015 = 18.555
 *       total    = round2(18.555)        = 18.56
 *       subtotal = round2(18.555 / 1.18) = 15.72
 *       igv      = round2(2.8305)        =  2.83   → 15.72 + 2.83 = 18.55 ✗
 *
 * Ese centavo se propagaba a la venta (`total` 192.17 contra `subtotal +
 * impuestos` 192.16), la dejaba impaga por 0.01 y viajaba al comprobante, donde
 * SUNAT lo toleró de casualidad.
 *
 * 🔑 **El total manda y el IGV absorbe el resto.** El total es lo que el cliente
 * paga, así que es lo que tiene que ser exacto; el subtotal se redondea normal
 * y el IGV se calcula como la diferencia. El error queda acotado a un centavo
 * en el IGV —inevitable, porque el monto real no existe en centavos— en vez de
 * romper la identidad. Es además lo que valida SUNAT: valorVenta + igv debe dar
 * el precio de venta.
 *
 * Por qué recién importa: hace falta una línea cuyo total no sea representable
 * en centavos. Con unidades enteras y precios de 2 decimales casi nunca pasa;
 * vendiendo por PESO —gramos × un precio de 6 decimales— pasa todo el tiempo.
 */
export function calcularMontosLinea(e: EntradaMontosLinea): MontosLinea {
  const descuento = e.descuento ?? 0;
  const porcentajeIGV = e.porcentajeIGV ?? 18;
  const icbper = round2(e.icbper ?? 0);

  const bruto = e.cantidad * e.precioUnitario - descuento;

  // Base imponible exacta, antes de redondear nada.
  const subtotalExacto = e.precioIncluyeIgv
    ? bruto / (1 + porcentajeIGV / 100)
    : bruto;

  const totalExacto = (e.precioIncluyeIgv
    ? bruto
    : subtotalExacto * (1 + porcentajeIGV / 100)) + icbper;

  const total = round2(totalExacto);
  const subtotal = round2(subtotalExacto);
  // El IGV sale por diferencia: es lo que hace que la identidad se cumpla.
  const igv = round2(total - icbper - subtotal);

  return { subtotal, igv, total, icbper };
}
