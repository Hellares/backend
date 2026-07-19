import { ContextoTool, DefinicionTool, ResultadoTool } from './tools/tool.types';

/**
 * Registro y ejecución de tools. El LLM propone (nombre + args); esto
 * dispone: busca la tool, la ejecuta con el CONTEXTO inyectado, y captura
 * errores como DATOS (nunca deja escapar una excepción cruda al loop).
 */
export class EjecutorTools {
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
    if (!tool) return { ok: false, motivo: 'TOOL_DESCONOCIDA' };
    try {
      return await tool.ejecutar(args ?? {}, ctx);
    } catch (e) {
      return {
        ok: false,
        motivo: 'ERROR_INTERNO',
        detalle: (e as Error).message,
      };
    }
  }
}
