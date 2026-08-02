import * as sharp from 'sharp';
import { generarMapaConPin } from './mapa-estatico.util';

/**
 * Sin red: los mosaicos se fabrican acá mismo. Así la prueba corre en CI y
 * no depende de que OpenStreetMap conteste.
 */
async function mosaicoFalso(): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 200, g: 220, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe('generarMapaConPin', () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('arma un JPEG de 640x420 con el punto al centro', async () => {
    const png = await mosaicoFalso();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => png,
    }) as any;

    const b64 = await generarMapaConPin(-8.1488553, -79.0452555);
    expect(b64).toBeTruthy();

    const meta = await sharp(Buffer.from(b64 as string, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(420);
  });

  it('pide los mosaicos a OSM identificándose con User-Agent', async () => {
    const png = await mosaicoFalso();
    const espia = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => png,
    });
    global.fetch = espia as any;

    await generarMapaConPin(-8.1488553, -79.0452555);

    expect(espia).toHaveBeenCalled();
    const [url, opciones] = espia.mock.calls[0];
    expect(String(url)).toMatch(
      /^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/,
    );
    // La política de uso de OSM exige identificar al cliente.
    expect(opciones.headers['User-Agent']).toContain('Syncronize');
  });

  it('devuelve null (sin lanzar) si OSM no responde', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as any;
    await expect(generarMapaConPin(-8.14, -79.04)).resolves.toBeNull();
  });

  it('devuelve null si la mayoría de los mosaicos falla', async () => {
    const png = await mosaicoFalso();
    let n = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      n += 1;
      // Solo el primero llega; el mapa quedaría demasiado agujereado.
      return n === 1 ? { ok: true, arrayBuffer: async () => png } : { ok: false };
    }) as any;

    await expect(generarMapaConPin(-8.14, -79.04)).resolves.toBeNull();
  });

  it('rechaza coordenadas inválidas sin tocar la red', async () => {
    const espia = jest.fn();
    global.fetch = espia as any;

    expect(await generarMapaConPin(NaN, 0)).toBeNull();
    expect(await generarMapaConPin(0, Infinity)).toBeNull();
    expect(await generarMapaConPin(91, 0)).toBeNull();
    expect(await generarMapaConPin(0, 181)).toBeNull();
    expect(espia).not.toHaveBeenCalled();
  });
});
