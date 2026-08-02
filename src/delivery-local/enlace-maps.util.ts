/**
 * Resuelve enlaces de Google Maps que el cliente comparte por WhatsApp.
 *
 * Existe porque los acortados (`maps.app.goo.gl`) no traen las coordenadas:
 * hay que seguir la redirección, y eso se hace acá y no en el celular —
 * el APK no debe andar siguiendo redirects a dominios externos.
 *
 * ⚠️ Este módulo hace peticiones a una URL que viene del CLIENTE, así que
 * es superficie de SSRF. Las defensas, en orden:
 *  1. la URL de entrada solo puede ser uno de los acortadores conocidos;
 *  2. cada salto de la redirección se valida contra dominios de Google;
 *  3. las redirecciones NO se siguen solas (`redirect: 'manual'`) — se leen
 *     los `Location` a mano, con tope de saltos;
 *  4. nunca se lee ni se devuelve el cuerpo de la respuesta, solo cabeceras.
 */

/** Único punto de entrada aceptado: los acortadores de Google Maps. */
const HOSTS_ACORTADOS = new Set(['maps.app.goo.gl', 'goo.gl']);

/**
 * Dominios de Google a los que se permite saltar. Cubre los de país
 * (`google.com.pe`), porque Google redirige según la IP del servidor.
 */
const RE_HOST_GOOGLE = /^(?:[a-z0-9-]+\.)*google(?:\.[a-z]{2,3}){1,2}$/;

const MAX_SALTOS = 5;
const TIMEOUT_MS = 8_000;

export interface PuntoResuelto {
  lat: number;
  lon: number;
}

export class EnlaceMapsError extends Error {}

/** ¿Es un acortador de Maps? Lo usa el service para decidir si resolver. */
export function esEnlaceAcortado(url: string): boolean {
  const host = hostDe(url);
  if (host === null) return false;
  if (host === 'maps.app.goo.gl') return true;
  return host === 'goo.gl' && rutaDe(url).startsWith('/maps');
}

/**
 * Sigue la redirección del acortador y devuelve las coordenadas.
 *
 * `fetchImpl` se inyecta para poder testear sin red.
 */
export async function resolverEnlaceAcortado(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PuntoResuelto> {
  if (!esEnlaceAcortado(url)) {
    throw new EnlaceMapsError('El enlace no es un acortador de Google Maps');
  }

  let actual = url;

  for (let salto = 0; salto < MAX_SALTOS; salto++) {
    // Un punto ya resoluble corta el ciclo antes de gastar otra petición.
    const punto = extraerCoordenadas(actual);
    if (punto) return punto;

    let respuesta: Response;
    try {
      respuesta = await fetchImpl(actual, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EnlaceMapsError('No se pudo contactar a Google Maps');
    }

    if (respuesta.status < 300 || respuesta.status >= 400) break;

    const destino = respuesta.headers.get('location');
    if (!destino) break;

    // `location` puede ser relativa: se resuelve contra la URL actual.
    let siguiente: string;
    try {
      siguiente = new URL(destino, actual).toString();
    } catch {
      throw new EnlaceMapsError('Google devolvió una redirección inválida');
    }

    const host = hostDe(siguiente);
    if (host === null || (!RE_HOST_GOOGLE.test(host) && !HOSTS_ACORTADOS.has(host))) {
      // Salir del dominio de Google es la señal de que algo no cuadra.
      throw new EnlaceMapsError('La redirección salió de Google Maps');
    }

    actual = siguiente;
  }

  const punto = extraerCoordenadas(actual);
  if (punto) return punto;

  throw new EnlaceMapsError(
    'El enlace no contiene una ubicación con coordenadas',
  );
}

/**
 * Saca el par lat/lon de una URL de Google Maps.
 *
 * Espeja al parser de la app (`ubicacion_compartida_parser.dart`) — si se
 * agrega un formato acá, agregarlo allá también. Precedencia: primero los
 * parámetros que nombran el DESTINO, después el marcador del lugar
 * (`!3d`/`!4d`), y al final el `@`, que es solo el centro de la cámara.
 */
export function extraerCoordenadas(url: string): PuntoResuelto | null {
  let uri: URL;
  try {
    uri = new URL(url);
  } catch {
    return null;
  }

  for (const clave of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const punto = parDeCoordenadas(uri.searchParams.get(clave));
    if (punto) return punto;
  }

  const entero = decodeURIComponent(url);

  const marcador = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(entero);
  if (marcador) {
    const punto = construir(marcador[1], marcador[2]);
    if (punto) return punto;
  }

  const camara = /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(entero);
  if (camara) {
    const punto = construir(camara[1], camara[2]);
    if (punto) return punto;
  }

  // `/maps/place/-6.77,-79.84/` — el pin va en la propia ruta.
  return parDeCoordenadas(decodeURIComponent(uri.pathname));
}

// ── Auxiliares ────────────────────────────────────────────────────────────

function hostDe(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    // Sin esto, un `file:` o un `gopher:` pasarían el filtro de host.
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

function rutaDe(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Exige decimales de ambos lados: si no, el `,17z` del zoom pasaría. */
function parDeCoordenadas(crudo: string | null): PuntoResuelto | null {
  if (!crudo) return null;
  const m = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(crudo);
  return m ? construir(m[1], m[2]) : null;
}

function construir(lat: string, lon: string): PuntoResuelto | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  // 0,0 es el relleno de `geo:` y cae en el Atlántico: nunca es un delivery.
  if (la === 0 && lo === 0) return null;
  return { lat: la, lon: lo };
}
