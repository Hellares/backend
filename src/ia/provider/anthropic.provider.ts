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
      /** Base del backoff entre reintentos (ms). Solo para specs. */
      backoffMs?: number;
    },
  ) {
    if (!opts.apiKey) {
      throw new Error('AnthropicProvider: falta la API key');
    }
  }

  async completar(params: ParametrosCompletar): Promise<MensajeAgente> {
    const modelo = this.opts.modelo ?? 'claude-haiku-4-5-20251001';
    const body: Record<string, unknown> = {
      model: modelo,
      max_tokens: this.opts.maxTokens ?? 1024,
      // Agente TRANSACCIONAL: la "creatividad" del default (1.0) es
      // exactamente inventar productos/montos. Temperatura baja = tool-calling
      // determinístico. Solo en modelos que aceptan sampling params (Haiku y
      // legacy; Sonnet 5 / Opus 4.7+ los RECHAZAN con 400).
      ...(/haiku|sonnet-4|opus-4-[05]|opus-4-1/.test(modelo)
        ? { temperature: 0.2 }
        : {}),
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

    const res = await this.postConReintentos(JSON.stringify(body));

    const data: any = await res.json();
    const bloques: BloqueContenido[] = (data.content ?? []).map(
      bloqueAnthropicANeutro,
    );
    return { rol: 'assistant', bloques };
  }

  /**
   * POST con REINTENTOS: 529 Overloaded / 5xx / 429 y errores de red se
   * reintentan con backoff creciente (hasta 3 intentos). El 07-21 seis 529
   * seguidos atravesaron el throw seco y dejaron a una clienta EN VISTO
   * (caso Rayza) — el retry absorbe picos cortos; si la caída es larga, el
   * error sube y el bot responde su mensaje fijo sin LLM.
   * Errores del CLIENTE (400/401/403…) NO se reintentan: son bugs o config
   * mala, repetirlos no los arregla.
   */
  private async postConReintentos(body: string): Promise<Response> {
    const MAX_INTENTOS = 3;
    const base = this.opts.backoffMs ?? 1000;
    for (let intento = 1; ; intento++) {
      let res: Response | null = null;
      let errorRed: Error | null = null;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.opts.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        errorRed = e as Error;
      }
      if (res?.ok) return res;

      const status = res?.status ?? 0;
      const reintentable =
        errorRed !== null || status === 429 || status >= 500;
      if (reintentable && intento < MAX_INTENTOS) {
        await new Promise((r) => setTimeout(r, base * intento));
        continue;
      }
      if (errorRed) throw errorRed;
      const detalle = await res!.text().catch(() => '');
      throw new Error(`Anthropic API ${status}: ${detalle.slice(0, 300)}`);
    }
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
