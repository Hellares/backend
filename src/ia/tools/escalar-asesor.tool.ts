import { DefinicionTool } from './tool.types';

/**
 * Tool `escalarAsesor` — el cliente pidió hablar con un HUMANO (asesor,
 * dueño, encargado, "una persona", "no quiero un bot"). La tool en sí no
 * toca la BD: devuelve ok y el BOT (código determinístico) detecta la traza
 * y silencia la conversación (estado ASESOR, 12h) + avisa a la empresa por
 * push. El mismo patrón foto/verDetalle: el LLM propone, el bot dispone.
 *
 * Se registra SOLO si la empresa tiene `escalarAHumano` activo.
 */
export function crearEscalarAsesorTool(): DefinicionTool {
  return {
    nombre: 'escalarAsesor',
    descripcion:
      'Pasa la conversación a un ASESOR HUMANO y silencia al asistente. ' +
      'Llámala EN CUANTO el cliente pida hablar con una persona, asesor, ' +
      'vendedor, encargado o dueño, o rechace seguir con un bot — no ' +
      'insistas en atenderlo tú. Tras llamarla despídete en UNA frase breve ' +
      '(el asesor continuará este mismo chat); no prometas tiempos.',
    parametros: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description:
            'Resumen corto de qué necesita el cliente (para el asesor).',
        },
      },
      required: [],
    },

    async ejecutar(args) {
      return {
        ok: true,
        motivo: String(args.motivo ?? '').slice(0, 200) || null,
        nota:
          'Un asesor humano continuará este chat; el asistente quedará en ' +
          'silencio. Despídete breve y cortés.',
      };
    },
  };
}
