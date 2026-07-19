import {
  AgenteIaProvider,
  BloqueContenido,
  MensajeAgente,
  ParametrosCompletar,
} from './agente-ia.provider';

/**
 * Provider Anthropic (Claude) — traduce el formato neutro a/desde la
 * Messages API y hace UN turno. Usa fetch (sin SDK, cero dependencias
 * nuevas para el spike). La API key se lee del entorno.
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 */
export class AnthropicProvider implements AgenteIaProvider {
  readonly nombre = 'anthropic';

  constructor(
    private readonly opts: {
      apiKey: string;
      modelo?: string;
      maxTokens?: number;
    },
  ) {
    if (!opts.apiKey) {
      throw new Error('AnthropicProvider: falta la API key');
    }
  }

  async completar(params: ParametrosCompletar): Promise<MensajeAgente> {
    const body = {
      model: this.opts.modelo ?? 'claude-haiku-4-5-20251001',
      max_tokens: this.opts.maxTokens ?? 1024,
      system: params.system,
      messages: params.mensajes.map((m) => ({
        role: m.rol,
        content: m.bloques.map(bloqueNeutroAAnthropic),
      })),
      tools: params.tools.map((t) => ({
        name: t.nombre,
        description: t.descripcion,
        input_schema: t.parametros,
      })),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${detalle.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const bloques: BloqueContenido[] = (data.content ?? []).map(
      bloqueAnthropicANeutro,
    );
    return { rol: 'assistant', bloques };
  }
}

/** Bloque neutro → formato Anthropic. */
function bloqueNeutroAAnthropic(b: BloqueContenido): any {
  switch (b.tipo) {
    case 'texto':
      return { type: 'text', text: b.texto };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.nombre, input: b.args };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.id, content: b.contenido };
  }
}

/** Bloque Anthropic → formato neutro. */
function bloqueAnthropicANeutro(b: any): BloqueContenido {
  if (b.type === 'tool_use') {
    return {
      tipo: 'tool_use',
      id: b.id,
      nombre: b.name,
      args: (b.input ?? {}) as Record<string, unknown>,
    };
  }
  // text (o cualquier otro → texto vacío para no romper)
  return { tipo: 'texto', texto: typeof b.text === 'string' ? b.text : '' };
}
