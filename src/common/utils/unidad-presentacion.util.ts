/**
 * Traduce una línea de venta desde la unidad en la que el sistema GUARDA a la
 * unidad en la que se le HABLA al cliente.
 *
 * Un alimento a granel se guarda en gramos —para que el stock entero aguante
 * los 22 000 de un saco y la lectura de la balanza sea un entero— pero nadie
 * cotiza en gramos. Con la presentación configurada (kg = 1000 g), la línea
 * `1500 g @ S/0.008` es la MISMA línea que `1.5 kg @ S/8.00`: mismo total,
 * distinta unidad. Esto último es lo que va al ticket y al comprobante.
 *
 * Espejo exacto de `core/utils/unidad_presentacion.dart` en la app.
 */

/** Unidad por defecto del catálogo 03 de SUNAT: unidad (bienes). */
export const UNIDAD_SUNAT_DEFAULT = 'NIU';

/**
 * Decimales de la cantidad declarada. Con base en gramos y presentación en
 * kilos, 3 decimales son exactamente 1 gramo — la resolución de una balanza
 * de retail. Es también la escala de `DetalleComprobante.cantidad`.
 */
const DECIMALES_CANTIDAD = 3;

/** Forma mínima de una unidad de medida de empresa para resolver su código. */
export interface UnidadParaSunat {
  unidadMaestra?: { codigo?: string | null } | null;
}

/** Forma mínima para resolver el símbolo legible de una unidad de empresa. */
export interface UnidadParaSimbolo {
  simboloLocal?: string | null;
  simboloPersonalizado?: string | null;
  unidadMaestra?: { simbolo?: string | null } | null;
}

/**
 * Símbolo legible de una unidad de empresa, ej. "kg".
 *
 * El override local de la empresa gana sobre el símbolo de la unidad maestra:
 * es exactamente para eso que existe. Nada que ver con `codigoSunatUnidad`,
 * que sí ignora lo personalizado — este símbolo es para leerlo un humano.
 */
export function simboloUnidad(
  unidad: UnidadParaSimbolo | null | undefined,
): string | null {
  if (!unidad) return null;
  return (
    unidad.simboloLocal ??
    unidad.simboloPersonalizado ??
    unidad.unidadMaestra?.simbolo ??
    null
  );
}

/**
 * Código SUNAT (catálogo 03) de una unidad de medida de empresa.
 *
 * ⚠️ SOLO se acepta el código de la unidad MAESTRA. Una unidad personalizada
 * ("100 g", "cja12") tiene `codigoPersonalizado` libre, elegido por el
 * usuario: mandarlo es mandar un código que no existe en el catálogo 03 y la
 * SUNAT rechaza el documento. Para esas, NIU — que es lo que se venía
 * mandando para todo y nunca falló.
 */
export function codigoSunatUnidad(
  unidad: UnidadParaSunat | null | undefined,
): string {
  const codigo = unidad?.unidadMaestra?.codigo?.trim();
  return codigo ? codigo.toUpperCase() : UNIDAD_SUNAT_DEFAULT;
}

/**
 * Presentación resuelta de una línea: en qué unidad se muestra y se declara.
 * `factor = 1` es el caso normal (sin presentación) y no altera ningún número.
 */
export interface PresentacionLinea {
  /** Unidades de venta que trae 1 de presentación (1 kg = 1000 g). */
  factor: number;
  /** Símbolo legible para el ticket, ej. "kg". Null si no hay presentación. */
  simbolo: string | null;
  /** Código del catálogo 03 con el que se declara la línea, ej. "KGM". */
  codigoSunat: string;
}

/** Línea sin presentación: se declara y se muestra tal cual está guardada. */
export function sinPresentacion(codigoSunat = UNIDAD_SUNAT_DEFAULT): PresentacionLinea {
  return { factor: 1, simbolo: null, codigoSunat };
}

/**
 * Clave con la que se indexa la presentación de una línea.
 *
 * ⚠️ Producto **y** variante. Dos variantes del mismo producto pueden venderse
 * en unidades distintas —el caso que viene es un saco cerrado (UND) y el granel
 * que sale de abrirlo (g)—, así que indexar solo por `productoId` las hace
 * colisionar: la segunda hereda la unidad de la primera y el comprobante
 * declara un saco de 15 kg como "1 KGM". SUNAT lo acepta, y miente.
 */
export function clavePresentacion(
  productoId?: string | null,
  varianteId?: string | null,
): string {
  return `${productoId ?? ''}|${varianteId ?? ''}`;
}

/**
 * Un factor tal como sale de la base: `Decimal` de Prisma, number o null.
 * Todos responden a `Number()`.
 */
type FactorCrudo = number | string | { valueOf(): unknown } | null | undefined;

/** Forma mínima de un producto para resolver en qué unidad se declara. */
export interface ProductoParaPresentacion {
  unidadMedidaId?: string | null;
  factorPresentacion?: FactorCrudo;
  unidadPresentacion?: (UnidadParaSimbolo & UnidadParaSunat) | null;
  unidadMedida?: UnidadParaSunat | null;
}

/** Forma mínima de una variante para resolver en qué unidad se declara. */
export interface VarianteParaPresentacion {
  unidadMedidaId?: string | null;
  unidadMedida?: UnidadParaSunat | null;
  /** Presentación PROPIA de la variante. Si existe, gana sobre la del producto. */
  factorPresentacion?: FactorCrudo;
  unidadPresentacion?: (UnidadParaSimbolo & UnidadParaSunat) | null;
  producto?: ProductoParaPresentacion | null;
}

/**
 * En qué unidad se declara una línea de este producto.
 *
 * Con presentación configurada y factor > 1, esa. Sin ella, la unidad de venta
 * del producto — que ya es mejor que el `NIU` fijo que se mandaba para todo.
 */
export function presentacionDeProducto(
  producto: ProductoParaPresentacion | null | undefined,
): PresentacionLinea {
  const factor = Number(producto?.factorPresentacion ?? 0);
  // La presentación existe para AGRUPAR: con factor <= 1 no agrupa nada y solo
  // metería divisiones inútiles. El create del producto ya lo valida, pero un
  // dato viejo o cargado por SQL no se valida solo.
  if (producto?.unidadPresentacion && factor > 1) {
    return {
      factor,
      simbolo: simboloUnidad(producto.unidadPresentacion),
      codigoSunat: codigoSunatUnidad(producto.unidadPresentacion),
    };
  }
  return sinPresentacion(codigoSunatUnidad(producto?.unidadMedida));
}

/**
 * En qué unidad se declara una línea de esta variante.
 *
 * Tres casos, en este orden:
 *
 * 1. La variante tiene presentación PROPIA → gana. Es el granel de un saco
 *    abierto: se guarda en gramos y se cobra en kilos, aunque el producto
 *    padre no tenga presentación o tenga otra.
 * 2. La variante declara su propia unidad de VENTA y es distinta a la del
 *    producto → la presentación del producto no es de ella. Un saco cerrado
 *    (UND) dentro de un producto cuya base es el gramo y su presentación el
 *    kilo saldría declarado como "1 KGM" por 15 kg de alimento.
 * 3. Si no, HEREDA la del producto. Es lo correcto mientras las variantes
 *    sean colores o tallas, que se venden todas en la misma unidad — y es el
 *    comportamiento de todas las variantes que existen hoy.
 */
export function presentacionDeVariante(
  variante: VarianteParaPresentacion | null | undefined,
): PresentacionLinea {
  const factorPropio = Number(variante?.factorPresentacion ?? 0);
  if (variante?.unidadPresentacion && factorPropio > 1) {
    return {
      factor: factorPropio,
      simbolo: simboloUnidad(variante.unidadPresentacion),
      codigoSunat: codigoSunatUnidad(variante.unidadPresentacion),
    };
  }

  const unidadPropia = variante?.unidadMedidaId ?? null;
  const unidadDelProducto = variante?.producto?.unidadMedidaId ?? null;

  if (unidadPropia && unidadPropia !== unidadDelProducto) {
    return sinPresentacion(codigoSunatUnidad(variante?.unidadMedida));
  }
  return presentacionDeProducto(variante?.producto);
}

/**
 * Una presentación solo "está activa" con factor > 1. Un factor de 1 no
 * agruparía nada (es la misma unidad de venta con otro nombre) y solo
 * introduciría divisiones inútiles; el backend ya lo rechaza al crear el
 * producto, pero los datos viejos no se validan solos.
 */
export function presentacionActiva(p: PresentacionLinea): boolean {
  return p.factor > 1;
}

/**
 * Cantidad guardada → cantidad declarada. 1500 g → 1.5 kg.
 *
 * Se redondea a 3 decimales porque es la escala de la columna: si acá
 * quedaran más decimales, Postgres los truncaría igual y el precio unitario
 * —que se deriva de ESTA cantidad— dejaría de reconstruir el total.
 */
export function cantidadDeclarada(
  cantidadEnUnidadDeVenta: number,
  p: PresentacionLinea,
): number {
  if (!presentacionActiva(p)) return cantidadEnUnidadDeVenta;
  const factor = 10 ** DECIMALES_CANTIDAD;
  return Math.round((cantidadEnUnidadDeVenta / p.factor) * factor) / factor;
}

/**
 * Los tres montos de una línea de comprobante, expresados en la unidad en la
 * que se declara.
 *
 * ⚠️ Los precios unitarios se DERIVAN de la cantidad ya redondeada, no se
 * multiplican por el factor. Es la diferencia entre un documento que cuadra y
 * uno que no: vendiendo 1.237 kg, `total / 1.237` reconstruye exactamente los
 * S/9.90 que pagó el cliente, mientras que `precioPorGramo × 1000` da 9.896 y
 * el proveedor arma la línea con dos centavos de diferencia.
 *
 * `subtotal` y `total` de la línea NO se tocan: son montos ya cerrados y son
 * los que mandan.
 */
export function montosDeclarados(
  linea: { cantidad: number; subtotal: number; total: number },
  p: PresentacionLinea,
): { cantidad: number; valorUnitario: number; precioUnitario: number } {
  const cantidad = cantidadDeclarada(linea.cantidad, p);
  // Cantidad 0 (o negativa por dato corrupto) no puede dividir. Cae al
  // comportamiento histórico: el monto entero como unitario de 1 unidad.
  const divisor = cantidad > 0 ? cantidad : 1;
  return {
    cantidad,
    valorUnitario: linea.subtotal / divisor,
    precioUnitario: linea.total / divisor,
  };
}
