/**
 * Operaciones que un administrador puede autorizar con su DNI + contraseña en
 * `POST /auth/autorizar-operacion`.
 *
 * **Para qué existe este catálogo.** Antes `operacion` era un string libre que
 * el servidor solo escribía en el log, sin compararlo con nada. Dos cosas malas
 * salían de ahí:
 *
 *  1. Nada garantizaba que el valor fuera algo real, así que la única traza de
 *     "quién autorizó qué" no era confiable.
 *  2. Los nombres se fueron separando solos: el app llegó a mandar `DESCUENTO`
 *     y `APLICAR_DESCUENTO` para la MISMA operación. Auditar "quién autorizó
 *     descuentos" dejaba afuera la mitad de los casos sin que nadie lo notara.
 *
 * **Cuándo agregar una acá**: cuando una pantalla nueva necesite pedir
 * autorización. El id va en MAYÚSCULAS con guión bajo, y describe la operación,
 * no la pantalla.
 *
 * ⚠️ Esto valida QUÉ se autoriza, no QUIÉN puede autorizarlo. Hoy cualquier
 * administrador (o GERENTE_SEDE / ADMINISTRADOR / SUPERVISOR de sede) puede
 * autorizar cualquiera de estas. Atar cada operación a un rol distinto es un
 * paso aparte, y necesita una decisión de negocio antes que código.
 */
export const OPERACIONES_AUTORIZABLES = [
  'ANULAR_VENTA',
  'ANULAR_MOVIMIENTO_CAJA',
  'APLICAR_DESCUENTO',
  'VENTA_BAJO_COSTO',
  'ACTIVAR_LIQUIDACION',
] as const;

export type OperacionAutorizable = (typeof OPERACIONES_AUTORIZABLES)[number];

/**
 * Nombres viejos que se aceptan y se traducen al canónico.
 *
 * 🔴 No se pueden borrar por ahora: el APK que está hoy instalado en los
 * celulares manda `DESCUENTO`. Rechazarlo dejaría sin poder autorizar
 * descuentos a todo el que no haya actualizado, que es exactamente el tipo de
 * rotura que un cambio de auditoría no debería causar.
 *
 * Traducirlos acá además arregla la traza HACIA ATRÁS: aunque el celular mande
 * el nombre viejo, en el log queda el canónico y la auditoría cierra.
 *
 * Se pueden sacar cuando no queden APKs viejos en la calle.
 */
const ALIAS: Readonly<Record<string, OperacionAutorizable>> = {
  DESCUENTO: 'APLICAR_DESCUENTO',
};

/**
 * Devuelve la operación canónica, o `null` si no existe.
 *
 * Tolera espacios y minúsculas: lo que se busca es rechazar operaciones que no
 * existen, no castigar un `\n` de más en el cliente.
 */
export function normalizarOperacion(
  valor: string | undefined,
): OperacionAutorizable | null {
  const limpio = (valor ?? '').trim().toUpperCase();
  if (!limpio) return null;

  const canonico = ALIAS[limpio];
  if (canonico) return canonico;

  return (OPERACIONES_AUTORIZABLES as readonly string[]).includes(limpio)
    ? (limpio as OperacionAutorizable)
    : null;
}
