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
