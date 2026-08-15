/**
 * Búsqueda unificada de productos.
 *
 * ## El problema que resuelve
 * La búsqueda vieja metía la **frase entera** como un solo substring contra
 * `nombre`, `descripcion` y `codigoEmpresa`. Buscar `"lavadora samsung"`
 * preguntaba si algún campo contenía esa cadena completa → **cero
 * resultados**, porque "lavadora" está en el nombre y "samsung" en la marca.
 * Y la marca ni siquiera se consultaba: vive en `EmpresaMarca` y su nombre no
 * es un campo sino `nombreLocal ?? nombrePersonalizado ?? maestra.nombre`.
 *
 * ## Cómo se resuelve
 * `Producto.textoBusqueda` concentra, ya normalizado, el nombre, la
 * descripción, los códigos y los nombres **resueltos** de marca y categoría.
 * La consulta se parte en palabras y se exige que **TODAS** aparezcan en esa
 * única columna (con índice GIN trigram). Así "lavadora samsung" encuentra el
 * producto, y "samsung lavadora" también: el orden no importa.
 *
 * 🔑 `normalizarBusqueda` **tiene que dar lo mismo que el SQL** que llena la
 * columna (`lower(unaccent(...))` en `texto-busqueda.service.ts`). Si una de
 * las dos cambia, la otra también: si no, deja de matchear en silencio.
 */

/** Cuántas palabras de la consulta se consideran. Corta consultas absurdas. */
export const MAX_TERMINOS_BUSQUEDA = 6;

/**
 * Minúsculas y sin tildes, espacios colapsados. Equivale a
 * `lower(unaccent(texto))` de Postgres: NFD descompone la tilde en un
 * carácter combinante aparte y el replace lo borra.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parte la consulta en palabras únicas, normalizadas.
 *
 * `%` y `_` se cambian por espacio: Prisma NO los escapa en `contains`, así
 * que llegarían al LIKE como comodines. Un `_` suelto haría que "co_e"
 * matcheara "cofe" y "cove".
 */
export function tokenizarBusqueda(texto: string): string[] {
  const normalizado = normalizarBusqueda(texto).replace(/[%_]/g, ' ');
  if (!normalizado.trim()) return [];

  const vistos = new Set<string>();
  const terminos: string[] = [];
  for (const palabra of normalizado.split(' ')) {
    if (!palabra || vistos.has(palabra)) continue;
    vistos.add(palabra);
    terminos.push(palabra);
    if (terminos.length === MAX_TERMINOS_BUSQUEDA) break;
  }
  return terminos;
}

/**
 * ¿La consulta parece un código (barras, SKU) y no una frase?
 *
 * Un escaneo de código de barras tiene que resolverse por igualdad exacta,
 * que es instantánea; no conviene degradarlo a búsqueda por palabras.
 */
export function pareceCodigo(consulta: string): boolean {
  const limpia = consulta.trim();
  return limpia.length > 0 && limpia.length < 50 && !limpia.includes(' ');
}

/**
 * Condición para que **todas** las palabras estén en `textoBusqueda`.
 *
 * Sin `mode: 'insensitive'` a propósito: la columna ya está en minúsculas y
 * sin tildes, igual que los términos. Un ILIKE acá solo agregaría trabajo.
 */
export function condicionTextoBusqueda(
  terminos: string[],
): { textoBusqueda: { contains: string } }[] {
  return terminos.map((termino) => ({ textoBusqueda: { contains: termino } }));
}

/**
 * Lo mismo pero para filas de `ProductoStock`, donde cada fila es una
 * VARIANTE: cada palabra puede caer en el texto del producto o en los datos
 * de la variante ("lavadora samsung blanca").
 *
 * ⚠️ Los campos de variante NO están normalizados en la base, así que se
 * comparan con ILIKE. Una variante llamada "Café" no la encuentra quien
 * escribe "cafe". Se arregla el día que la variante tenga su propia columna
 * normalizada; hasta entonces es una limitación conocida.
 */
export function condicionStockPorPalabras(terminos: string[]) {
  return terminos.map((termino) => ({
    OR: [
      { producto: { textoBusqueda: { contains: termino } } },
      // 🔴 El nombre del PRODUCTO DUEÑO de la variante.
      //
      // En una fila de stock de variante el `productoId` es NULL —es el XOR
      // del modelo: la fila cuelga de la variante, no del producto—, así que
      // la primera condición nunca matchea ahí. Sin esta, buscar "ALIMENTO
      // PARA RATON" no devolvía NINGUNA de sus variantes: había que adivinar
      // el nombre de la variante ("GRANEL"), que además trae las de todos los
      // productos mezcladas. Las filas eran inalcanzables por nombre de
      // producto.
      { variante: { producto: { textoBusqueda: { contains: termino } } } },
      { variante: { nombre: { contains: termino, mode: 'insensitive' as const } } },
      { variante: { sku: { contains: termino, mode: 'insensitive' as const } } },
      {
        variante: {
          codigoBarras: { contains: termino, mode: 'insensitive' as const },
        },
      },
    ],
  }));
}
