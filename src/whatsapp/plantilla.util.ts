/**
 * Render de plantillas de WhatsApp con variables `{nombre}`.
 * Regla compartida por todas las plantillas (premio, pago): las líneas
 * cuyas variables queden TODAS vacías se eliminan del mensaje final.
 */
export function renderPlantilla(
  plantilla: string,
  valores: Record<string, string>,
): string {
  const resultado: string[] = [];
  for (const linea of plantilla.split('\n')) {
    const tokens = [...linea.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (tokens.length > 0) {
      const algunaConValor = tokens.some((t) => (valores[t] ?? '').trim());
      if (!algunaConValor) continue;
    }
    resultado.push(linea.replace(/\{(\w+)\}/g, (_, t) => valores[t] ?? ''));
  }
  return resultado.join('\n').trim();
}

/**
 * Plantillas default de las instrucciones de pago del BOT (tras el
 * registro del participante), una por tipo de sorteo. Variables:
 * {monto} = precio de la participación, {numero} = celular Yape de
 * IntegracionYape, {empresa} = nombre comercial. La empresa puede
 * personalizarlas, p.ej. agregando el nombre de la cuenta Yape:
 * "al *{numero}* (SYNCRONIZE)".
 */
export const PLANTILLA_PAGO_SORTEO_DEFAULT = [
  '💰 *Siguiente paso — el pago:*',
  'Yapea *{monto}* al *{numero}* y envía tu captura por este chat.',
  'Cuando lo validemos te confirmaremos tu *número de ticket* 🎟️',
].join('\n');

export const PLANTILLA_PAGO_DINAMICA_DEFAULT = [
  '💰 *Siguiente paso — el pago:*',
  'Yapea *{monto}* al *{numero}* y envía tu captura por este chat.',
  'Lo validamos y te confirmamos tu participación 🎟️',
].join('\n');

/**
 * Cabeceras del mensaje de CONFIRMACIÓN al validar el pago (el cuerpo —
 * datos de envío — lo arma el bot). Variables: {nombre} = primer nombre
 * del participante, {titulo} = nombre del sorteo/dinámica, {ticket} =
 * número de ticket (#N), {empresa} = nombre comercial.
 */
export const PLANTILLA_CONFIRMACION_SORTEO_DEFAULT =
  '🎟️ ¡Pago confirmado, {nombre}! Ya estás participando en *{titulo}* ' +
  'con el ticket *{ticket}*. ¡Mucha suerte! 🍀';

export const PLANTILLA_CONFIRMACION_DINAMICA_DEFAULT =
  '🎟️ ¡Pago confirmado, {nombre}! Ya estás participando en *{titulo}*. ' +
  '¡Mucha suerte! 🍀';
