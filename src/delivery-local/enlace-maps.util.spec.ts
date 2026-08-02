import {
  EnlaceMapsError,
  esEnlaceAcortado,
  extraerCoordenadas,
  resolverEnlaceAcortado,
} from './enlace-maps.util';

/**
 * Resolución de enlaces de Maps compartidos por WhatsApp.
 *
 * Lo que no puede romperse:
 *  - solo se aceptan los acortadores de Google como entrada,
 *  - ninguna redirección puede sacarnos del dominio de Google (SSRF),
 *  - el `@` de la cámara nunca gana sobre el marcador real del lugar.
 */
describe('enlace-maps.util', () => {
  // Chiclayo, para que los valores se parezcan a los reales.
  const LAT = -6.771389;
  const LON = -79.840833;

  /** Respuesta mínima con lo único que se lee: status y `location`. */
  const respuesta = (status: number, location?: string) =>
    ({
      status,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'location' ? (location ?? null) : null,
      },
    }) as unknown as Response;

  describe('esEnlaceAcortado', () => {
    it('acepta los acortadores de Maps', () => {
      expect(esEnlaceAcortado('https://maps.app.goo.gl/AbC123')).toBe(true);
      expect(esEnlaceAcortado('https://goo.gl/maps/XyZ789')).toBe(true);
    });

    it('rechaza goo.gl que no sea de maps', () => {
      expect(esEnlaceAcortado('https://goo.gl/otracosa')).toBe(false);
    });

    it('rechaza un enlace de Maps ya expandido', () => {
      expect(
        esEnlaceAcortado(`https://www.google.com/maps/?q=${LAT},${LON}`),
      ).toBe(false);
    });

    it('rechaza esquemas que no sean http(s)', () => {
      expect(esEnlaceAcortado('file:///etc/passwd')).toBe(false);
      expect(esEnlaceAcortado('ftp://maps.app.goo.gl/AbC')).toBe(false);
      expect(esEnlaceAcortado('no es una url')).toBe(false);
    });
  });

  describe('extraerCoordenadas', () => {
    const esperar = (url: string) => {
      const p = extraerCoordenadas(url);
      expect(p).not.toBeNull();
      expect(p!.lat).toBeCloseTo(LAT, 4);
      expect(p!.lon).toBeCloseTo(LON, 4);
    };

    it('lee el parámetro q', () => {
      esperar(`https://maps.google.com/?q=${LAT},${LON}`);
    });

    it('lee el formato api=1', () => {
      esperar(
        `https://www.google.com/maps/search/?api=1&query=${LAT},${LON}`,
      );
    });

    it('prefiere el marcador !3d!4d sobre la cámara @', () => {
      // El @ está corrido a propósito: no debe ganar.
      esperar(
        `https://www.google.com/maps/place/Local/@-6.5,-79.5,17z/data=!3d${LAT}!4d${LON}`,
      );
    });

    it('cae al @ cuando no hay marcador', () => {
      esperar(`https://www.google.com/maps/@${LAT},${LON},17z`);
    });

    it('lee coordenadas puestas en la ruta', () => {
      esperar(`https://www.google.com/maps/place/${LAT},${LON}/`);
    });

    it('descarta 0,0 y lo que se sale de rango', () => {
      expect(extraerCoordenadas('https://maps.google.com/?q=0.0,0.0')).toBeNull();
      expect(
        extraerCoordenadas('https://maps.google.com/?q=95.5,-79.8'),
      ).toBeNull();
      expect(
        extraerCoordenadas('https://maps.google.com/?q=-6.7,200.5'),
      ).toBeNull();
    });

    it('devuelve null si no hay nada parseable', () => {
      expect(extraerCoordenadas('https://www.google.com/maps')).toBeNull();
      expect(extraerCoordenadas('no es una url')).toBeNull();
    });
  });

  describe('resolverEnlaceAcortado', () => {
    it('sigue la redirección y devuelve el punto', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(
          respuesta(302, `https://www.google.com/maps/@${LAT},${LON},17z`),
        );

      const p = await resolverEnlaceAcortado(
        'https://maps.app.goo.gl/AbC123',
        fetchFalso as any,
      );

      expect(p.lat).toBeCloseTo(LAT, 4);
      expect(p.lon).toBeCloseTo(LON, 4);
      expect(fetchFalso).toHaveBeenCalledTimes(1);
    });

    it('nunca sigue las redirecciones solo (así valida cada salto)', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(respuesta(302, `https://maps.google.com/?q=${LAT},${LON}`));

      await resolverEnlaceAcortado(
        'https://maps.app.goo.gl/AbC123',
        fetchFalso as any,
      );

      expect(fetchFalso.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    });

    it('acepta dominios de Google por país', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(
          respuesta(302, `https://www.google.com.pe/maps/@${LAT},${LON},17z`),
        );

      const p = await resolverEnlaceAcortado(
        'https://maps.app.goo.gl/AbC123',
        fetchFalso as any,
      );
      expect(p.lat).toBeCloseTo(LAT, 4);
    });

    it('resuelve un location relativo contra la URL actual', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValueOnce(respuesta(302, 'https://www.google.com/maps/x'))
        .mockResolvedValueOnce(respuesta(302, `/maps/@${LAT},${LON},17z`));

      const p = await resolverEnlaceAcortado(
        'https://maps.app.goo.gl/AbC123',
        fetchFalso as any,
      );
      expect(p.lon).toBeCloseTo(LON, 4);
    });

    // ── SSRF ──────────────────────────────────────────────────────────────

    it('rechaza una URL de entrada que no sea acortador de Maps', async () => {
      const fetchFalso = jest.fn();
      await expect(
        resolverEnlaceAcortado('http://169.254.169.254/latest/meta-data/', fetchFalso as any),
      ).rejects.toBeInstanceOf(EnlaceMapsError);
      // Ni siquiera se intentó la petición.
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('corta si la redirección apunta fuera de Google', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(respuesta(302, 'http://169.254.169.254/latest/meta-data/'));

      await expect(
        resolverEnlaceAcortado(
          'https://maps.app.goo.gl/AbC123',
          fetchFalso as any,
        ),
      ).rejects.toThrow(/salió de Google/);
      // El salto peligroso nunca se pidió: solo se llamó al acortador.
      expect(fetchFalso).toHaveBeenCalledTimes(1);
    });

    it('corta ante un dominio que solo se parece a Google', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(respuesta(302, 'https://google.com.atacante.pe/maps'));

      await expect(
        resolverEnlaceAcortado(
          'https://maps.app.goo.gl/AbC123',
          fetchFalso as any,
        ),
      ).rejects.toThrow(/salió de Google/);
    });

    // ── Fallos ────────────────────────────────────────────────────────────

    it('no gira infinito ante un ciclo de redirecciones', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(respuesta(302, 'https://maps.app.goo.gl/AbC123'));

      await expect(
        resolverEnlaceAcortado(
          'https://maps.app.goo.gl/AbC123',
          fetchFalso as any,
        ),
      ).rejects.toBeInstanceOf(EnlaceMapsError);
      expect(fetchFalso.mock.calls.length).toBeLessThanOrEqual(5);
    });

    it('avisa cuando el destino no trae coordenadas', async () => {
      const fetchFalso = jest
        .fn()
        .mockResolvedValue(respuesta(302, 'https://www.google.com/maps'));

      await expect(
        resolverEnlaceAcortado(
          'https://maps.app.goo.gl/AbC123',
          fetchFalso as any,
        ),
      ).rejects.toThrow(/no contiene una ubicación/);
    });

    it('convierte un fallo de red en EnlaceMapsError', async () => {
      const fetchFalso = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        resolverEnlaceAcortado(
          'https://maps.app.goo.gl/AbC123',
          fetchFalso as any,
        ),
      ).rejects.toThrow(/No se pudo contactar/);
    });
  });
});
