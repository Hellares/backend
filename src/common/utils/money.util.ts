/**
 * Redondeo monetario a 2 decimales (centavos).
 *
 * ÚNICO punto de redondeo para MONTOS: mezclar `Math.round(x*100)/100`
 * con `toFixed(2)` en cálculos produce divergencias de centavo en casos
 * borde. Para persistir en columnas Decimal de Prisma el patrón correcto
 * sigue siendo `new Prisma.Decimal(x.toFixed(2))` (string exacto);
 * `round2` es para aritmética intermedia y respuestas numéricas.
 *
 * ⚠️ Un monto NO es lo mismo que un precio unitario: para eso está
 * `round6`. Ver abajo.
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Redondeo de PRECIOS UNITARIOS a 6 decimales.
 *
 * Un precio unitario no es un monto: es una tasa que después se multiplica
 * por la cantidad. Redondearlo a centavos rompe todo producto cuya unidad
 * atómica es chica, porque el error se multiplica por miles de unidades:
 *
 * - Alimento a granel: saco de 22 kg a S/147.99 con unidad base en gramos
 *   son S/0.006727/g. Redondeado a 2 decimales queda `0.01`/g = S/10/kg,
 *   un **48% inflado**.
 * - Cuero: (140 cm × 0.04 + 1000 cm × 0.05) / 1140 = 0.048772/cm. A 2
 *   decimales queda 0.05, un 2.5% arriba en cada compra, y el error se
 *   acumula compra tras compra en el promedio ponderado.
 *
 * Con 6 decimales, la granularidad por kilo es de S/0.001 y el total de la
 * compra vuelve a cuadrar con la factura del proveedor. Las columnas de
 * precio unitario son `Decimal(14,6)`; los montos (subtotal, igv, total)
 * siguen en 2 decimales con `round2`, que es lo que exige SUNAT.
 */
export const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;
