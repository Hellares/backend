import { Logger } from '@nestjs/common';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tools/tool.types';

/**
 * Registro y ejecución de tools. El LLM propone (nombre + args); esto
 * dispone: busca la tool, la ejecuta con el CONTEXTO inyectado, y captura
 * errores como DATOS (nunca deja escapar una excepción cruda al loop).
 *
 * Observabilidad: todo `ok:false` se loguea aquí (tool + motivo + args) —
 * el LLM ve el error como dato, pero el backend deja rastro para diagnosticar.
 */
export class EjecutorTools {
  private static readonly logger = new Logger('AgenteIaTools');
  private readonly mapa = new Map<string, DefinicionTool>();

  registrar(...tools: DefinicionTool[]): this {
    for (const t of tools) this.mapa.set(t.nombre, t);
    return this;
  }

  /** Definiciones a entregar al LLM (según las tools registradas). */
  definiciones(): DefinicionTool[] {
    return [...this.mapa.values()];
  }

  async ejecutar(
    nombre: string,
    args: Record<string, unknown>,
    ctx: ContextoTool,
  ): Promise<ResultadoTool> {
    const tool = this.mapa.get(nombre);
    if (!tool) {
      EjecutorTools.logger.warn(`tool desconocida: ${nombre}`);
      return { ok: false, motivo: 'TOOL_DESCONOCIDA' };
    }
    let resultado: ResultadoTool;
    try {
      resultado = await tool.ejecutar(args ?? {}, ctx);
    } catch (e) {
      resultado = {
        ok: false,
        motivo: 'ERROR_INTERNO',
        detalle: (e as Error).message,
      };
    }
    if (!resultado.ok) {
      EjecutorTools.logger.warn(
        `${nombre} → ${resultado.motivo}` +
          (resultado.detalle ? ` (${resultado.detalle})` : '') +
          ` args=${JSON.stringify(args ?? {})}`,
      );
    }
    return resultado;
  }
}
