/**
 * Redondeo monetario a 2 decimales (centavos).
 *
 * ÚNICO punto de redondeo para montos: mezclar `Math.round(x*100)/100`
 * con `toFixed(2)` en cálculos produce divergencias de centavo en casos
 * borde. Para persistir en columnas Decimal de Prisma el patrón correcto
 * sigue siendo `new Prisma.Decimal(x.toFixed(2))` (string exacto);
 * `round2` es para aritmética intermedia y respuestas numéricas.
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
