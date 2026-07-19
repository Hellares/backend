import { DefinicionTool } from '../tools/tool.types';

/**
 * Abstracción AGNÓSTICA del proveedor de IA (Claude/GPT/Gemini...).
 * Igual que el patrón de facturación (Nubefact/Syncrofact) y api-yape:
 * el agente no sabe qué modelo hay detrás; cada provider traduce a/desde
 * su formato nativo de tool-calling.
 *
 * Formato NEUTRO de mensajes (cubre el ciclo de tool-calling):
 *   user      → texto del cliente, o resultados de tools (tool_result)
 *   assistant → texto para el cliente, y/o solicitudes de tools (tool_use)
 */

export type RolMensaje = 'user' | 'assistant';

export type BloqueContenido =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'tool_use';
      id: string;
      nombre: string;
      args: Record<string, unknown>;
    }
  | { tipo: 'tool_result'; id: string; contenido: string };

export interface MensajeAgente {
  rol: RolMensaje;
  bloques: BloqueContenido[];
}

export interface ParametrosCompletar {
  /** Prompt de sistema (Capa A fija + Capa B empresa + Capa C runtime). */
  system: string;
  /** Historial de la conversación en formato neutro. */
  mensajes: MensajeAgente[];
  /** Tools disponibles (según el modo/permisos de la empresa). */
  tools: DefinicionTool[];
}

/**
 * Un turno del LLM: recibe el estado y devuelve el mensaje del assistant
 * (con bloques de texto y/o tool_use). El LOOP (ejecutar tools, reenviar
 * resultados) vive en AgenteService — el provider solo hace UN turno.
 */
export interface AgenteIaProvider {
  readonly nombre: string; // "anthropic" | "openai" | ...
  completar(params: ParametrosCompletar): Promise<MensajeAgente>;
}
