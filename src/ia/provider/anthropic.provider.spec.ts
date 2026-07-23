import { AnthropicProvider } from './anthropic.provider';

/**
 * Reintentos del provider (incidente Rayza 07-21): seis 529 Overloaded
 * seguidos atravesaron el throw seco y dejaron a una clienta EN VISTO.
 * Transitorios (529/5xx/429/red) se reintentan con backoff; errores del
 * cliente (400/401) NO — repetirlos no los arregla.
 */
describe('AnthropicProvider — reintentos ante 529/red', () => {
  const params = { system: 's', mensajes: [], tools: [] } as any;
  const resOk = () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'hola' }] }),
    }) as any;
  const resError = (status: number) =>
    ({
      ok: false,
      status,
      text: async () => `{"type":"error","status":${status}}`,
    }) as any;

  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // backoffMs: 1 → el spec no espera segundos reales.
  const provider = () => new AnthropicProvider({ apiKey: 'k', backoffMs: 1 });

  it('529 → reintenta y responde cuando la API se recupera', async () => {
    fetchMock
      .mockResolvedValueOnce(resError(529))
      .mockResolvedValueOnce(resError(529))
      .mockResolvedValueOnce(resOk());
    const r = await provider().completar(params);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.bloques).toEqual([{ tipo: 'texto', texto: 'hola' }]);
  });

  it('529 persistente → agota 3 intentos y lanza (el bot manda su mensaje fijo)', async () => {
    fetchMock.mockResolvedValue(resError(529));
    await expect(provider().completar(params)).rejects.toThrow(
      'Anthropic API 529',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('error de red (fetch rechaza) → también reintenta', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(resOk());
    const r = await provider().completar(params);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.bloques).toHaveLength(1);
  });

  it('400 (error del cliente) → NO reintenta: falla de una', async () => {
    fetchMock.mockResolvedValue(resError(400));
    await expect(provider().completar(params)).rejects.toThrow(
      'Anthropic API 400',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
