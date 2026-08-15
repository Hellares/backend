/**
 * Cómo se arma el NOMBRE de una variante a partir de sus atributos.
 *
 * Vive suelto porque lo usan dos caminos que antes no coincidían: el generador
 * de combinaciones —que armaba el nombre una sola vez, al crear— y el guardado
 * de atributos de una variante, que directamente no lo tocaba. Por eso asignar
 * atributos a mano dejaba el nombre viejo para siempre.
 */

export interface AtributoParaNombre {
  valor: string;
  orden: number;
  usarEnNombreVariante: boolean;
}

/** Lo que separa los valores. En un ticket de 58 mm el " / " respira mejor. */
const SEPARADOR = ' / ';

/**
 * Arma el nombre con los valores de los atributos MARCADOS, ordenados por
 * `orden`.
 *
 * 🔑 Van los valores solos, sin el nombre del atributo: "Etapa ADULTO / Sabor
 * POLLO / Presentación SACO 15KG" son 79 caracteres y tres líneas en 58 mm, y
 * las palabras Etapa/Sabor/Presentación no agregan nada porque el valor ya se
 * explica solo. El grupo se sigue viendo etiquetado en los chips del selector,
 * que es donde sí hace falta.
 *
 * Si NINGÚN atributo está marcado se cae a todos: es preferible un nombre
 * largo a una variante sin nombre.
 */
export function construirNombreVariante(
  atributos: AtributoParaNombre[],
): string {
  const conValor = atributos.filter((a) => a.valor.trim().length > 0);
  if (conValor.length === 0) return '';

  const marcados = conValor.filter((a) => a.usarEnNombreVariante);
  const usar = marcados.length > 0 ? marcados : conValor;

  return [...usar]
    .sort((a, b) => a.orden - b.orden)
    .map((a) => a.valor.trim())
    .join(SEPARADOR);
}

/**
 * ¿El nombre actual lo generamos nosotros, o lo escribió una persona?
 *
 * 🔴 Sin esta pregunta, recalcular pisaría los nombres puestos a mano, que es
 * justo lo que nadie quiere. Se compara contra DOS candidatos:
 *
 *  1. el nombre que saldría hoy con los atributos marcados, y
 *  2. el que saldría usándolos TODOS.
 *
 * El segundo existe porque las variantes creadas antes de que el flag
 * existiera se nombraron con todos los atributos; sin ese candidato, ninguna
 * de las que ya están en la base volvería a actualizarse nunca.
 */
export function nombreEsAutogenerado(
  nombreActual: string,
  atributos: AtributoParaNombre[],
): boolean {
  const actual = nombreActual.trim();
  if (actual.length === 0) return true;

  const conMarcados = construirNombreVariante(atributos);
  const conTodos = construirNombreVariante(
    atributos.map((a) => ({ ...a, usarEnNombreVariante: true })),
  );

  return actual === conMarcados || actual === conTodos;
}
