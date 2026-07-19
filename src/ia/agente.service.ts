import {
  AgenteIaProvider,
  BloqueContenido,
  MensajeAgente,
} from './provider/agente-ia.provider';
import { EjecutorTools } from './ejecutor-tools';
import { ContextoTool } from './tools/tool.types';

export interface TrazaTurno {
  iteracion: number;
  tools: { nombre: string; args: unknown; resultado: unknown }[];
  texto?: string;
}

export interface ResultadoConversacion {
  texto: string; // lo que se le responde al cliente
  iteraciones: number;
  trazas: TrazaTurno[];
}

/**
 * LOOP del agente (agnóstico del proveedor):
 *   mensaje del cliente → LLM decide → si pide tools, se ejecutan y se
 *   reenvían los resultados → LLM decide otra vez → ... → texto final.
 *
 * La IA CONVERSA; las tools (y por dentro tu código determinístico)
 * EJECUTAN. El loop solo orquesta y corta en `maxIteraciones` para que
 * nunca gire infinito.
 */
export class AgenteService {
  constructor(
    private readonly provider: AgenteIaProvider,
    private readonly ejecutor: EjecutorTools,
  ) {}

  async responder(params: {
    system: string;
    mensajeCliente: string;
    ctx: ContextoTool;
    /** Historial previo (para conversaciones multi-mensaje). */
    historialPrevio?: MensajeAgente[];
    maxIteraciones?: number;
    /**
     * Guard determinístico sobre la respuesta FINAL: si devuelve una
     * instrucción (string), la respuesta se rechaza y se reinyecta al LLM
     * para corregirla (una sola vez). null = respuesta válida.
     */
    validarFinal?: (texto: string) => string | null;
  }): Promise<ResultadoConversacion> {
    const tools = this.ejecutor.definiciones();
    const max = params.maxIteraciones ?? 6;
    const trazas: TrazaTurno[] = [];
    let corregido = false;

    const historial: MensajeAgente[] = [
      ...(params.historialPrevio ?? []),
      { rol: 'user', bloques: [{ tipo: 'texto', texto: params.mensajeCliente }] },
    ];

    for (let i = 0; i < max; i++) {
      const asistente = await this.provider.completar({
        system: params.system,
        mensajes: historial,
        tools,
      });
      historial.push(asistente);

      const usos = asistente.bloques.filter(
        (b): b is Extract<BloqueContenido, { tipo: 'tool_use' }> =>
          b.tipo === 'tool_use',
      );
      const textoTurno = asistente.bloques
        .filter((b): b is Extract<BloqueContenido, { tipo: 'texto' }> =>
          b.tipo === 'texto',
        )
        .map((b) => b.texto)
        .join('\n')
        .trim();

      // Sin tools → el agente terminó su respuesta al cliente.
      if (usos.length === 0) {
        // Guard determinístico: una respuesta inválida (ej. número de Yape
        // inventado) se rechaza y se reinyecta para que el LLM la corrija
        // llamando a las tools de verdad. Una sola corrección por turno.
        if (params.validarFinal && !corregido) {
          const nudge = params.validarFinal(textoTurno);
          if (nudge) {
            corregido = true;
            trazas.push({ iteracion: i + 1, tools: [], texto: textoTurno });
            historial.push({
              rol: 'user',
              bloques: [{ tipo: 'texto', texto: nudge }],
            });
            continue;
          }
        }
        trazas.push({ iteracion: i + 1, tools: [], texto: textoTurno });
        return { texto: textoTurno, iteraciones: i + 1, trazas };
      }

      // Ejecutar las tools solicitadas y reenviar resultados al LLM.
      const resultados: BloqueContenido[] = [];
      const trazaTools: TrazaTurno['tools'] = [];
      for (const u of usos) {
        const r = await this.ejecutor.ejecutar(u.nombre, u.args, params.ctx);
        resultados.push({
          tipo: 'tool_result',
          id: u.id,
          contenido: JSON.stringify(r),
        });
        trazaTools.push({ nombre: u.nombre, args: u.args, resultado: r });
      }
      trazas.push({ iteracion: i + 1, tools: trazaTools, texto: textoTurno });
      historial.push({ rol: 'user', bloques: resultados });
    }

    return {
      texto:
        'Disculpa, no pude completar tu solicitud ahora. ¿Intentamos de nuevo?',
      iteraciones: max,
      trazas,
    };
  }
}
