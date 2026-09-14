/**
 * ¿Cuánto se puede devolver todavía de una venta?
 *
 * 🔴 Antes solo se comparaba cada devolución contra lo VENDIDO, sin restar lo
 * que ya se había devuelto. En beta la venta 927 (1 unidad, S/ 500) aceptó dos
 * devoluciones: salieron S/ 1.000 de caja y entraron 2 unidades al stock. La
 * reversión total (`crearReversionTotal`) ya restaba las previas; la devolución
 * normal no.
 *
 * Se compara por PRODUCTO (la variante manda): una venta puede tener el mismo
 * producto en varias líneas, y una devolución también.
 */

export interface LineaVendida {
  productoId: string | null;
  varianteId: string | null;
  /** Llega como Decimal o string desde Prisma. */
  cantidad: number | string | { toString(): string };
  descripcion?: string | null;
}

export interface LineaDevuelta {
  productoId: string | null;
  varianteId: string | null;
  cantidad: number;
}

const clave = (l: { productoId: string | null; varianteId: string | null }) =>
  `${l.productoId ?? ''}|${l.varianteId ?? ''}`;

const sumarPorClave = (lineas: Array<{ productoId: string | null; varianteId: string | null; cantidad: unknown }>) => {
  const total = new Map<string, number>();
  for (const l of lineas) {
    // Una línea de servicio no mueve stock ni se devuelve por acá.
    if (!l.productoId && !l.varianteId) continue;
    total.set(clave(l), (total.get(clave(l)) ?? 0) + Number(l.cantidad));
  }
  return total;
};

/**
 * El motivo del rechazo, o `null` si todo lo pedido entra en lo que queda por
 * devolver.
 *
 * @param vendidas     detalles de la venta
 * @param yaDevueltas  ítems de las devoluciones ANTERIORES de esa venta que
 *                     cuentan (quien llama decide cuáles: al crear, todas las
 *                     no canceladas ni rechazadas; al procesar, las procesadas)
 * @param pedidas      ítems de la devolución que se está validando
 */
export function validarCantidadesDevolucion(
  vendidas: LineaVendida[],
  yaDevueltas: LineaDevuelta[],
  pedidas: LineaDevuelta[],
): string | null {
  const vendido = sumarPorClave(vendidas);
  const devuelto = sumarPorClave(yaDevueltas);
  const pedido = sumarPorClave(pedidas);

  for (const [k, cantidad] of pedido) {
    const v = vendido.get(k) ?? 0;
    const ya = devuelto.get(k) ?? 0;
    if (ya + cantidad <= v) continue;

    const nombre = vendidas.find((l) => clave(l) === k)?.descripcion;
    const quedan = Math.max(v - ya, 0);
    return (
      `${nombre ? `"${nombre}": ` : ''}se ${v === 1 ? 'vendió 1 unidad' : `vendieron ${v}`} ` +
      `y ya se ${ya === 1 ? 'devolvió 1' : `devolvieron ${ya}`}. ` +
      (quedan > 0
        ? `Se pueden devolver ${quedan} más, no ${cantidad}.`
        : 'No queda nada por devolver de este producto.')
    );
  }
  return null;
}
