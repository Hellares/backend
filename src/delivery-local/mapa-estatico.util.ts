import { Logger } from '@nestjs/common';
// `import sharp from` rompe en runtime: este repo no usa esModuleInterop.
import * as sharp from 'sharp';

/** Un fallo mudo acá deja el mensaje sin mapa y sin pista de por qué. */
const logger = new Logger('MapaEstatico');

/**
 * Recorta un mapa de OpenStreetMap alrededor de un punto y le dibuja el
 * marcador encima. Devuelve un JPEG en base64, listo para `sendImage`.
 *
 * ¿Por qué existe esto? Evolution v2.3.7 arma el mensaje de ubicación con
 * solo cuatro campos (lat, lon, name, address) — verificado en su código —
 * así que NO hay forma de mandarle la miniatura. WhatsApp espera esa imagen
 * del que envía y, sin ella, dibuja el recuadro del mapa SIN el pin. Que el
 * repartidor vea el mapa pero no el punto es justamente lo inservible.
 * Generando la imagen acá el marcador siempre sale, y el enlace de Google
 * Maps viaja en el pie del mensaje para que abrir y navegar sea un toque.
 *
 * ⚠️ Los mosaicos salen de tile.openstreetmap.org, que es gratis pero pide
 * identificarse con User-Agent y prohíbe la descarga masiva. Compartir la
 * dirección de un pedido es un puñado de imágenes por día y entra holgado;
 * si algún día esto se usara en un bucle o por lote, hay que pasar a un
 * proveedor propio de mosaicos.
 */

const TILE = 256;
const ZOOM = 16;
const ANCHO = 640;
const ALTO = 420;
/** Corte por mosaico: si OSM tarda, preferimos degradar a texto antes que colgar el envío. */
const TIMEOUT_MS = 4000;
/** Tope de seguridad: con 640×420 a zoom 16 nunca pasa de 4×3. */
const MAX_MOSAICOS = 20;

const USER_AGENT = 'Syncronize/1.0 (delivery; https://syncronize.net.pe)';

/** Web Mercator: grados → píxel absoluto del mapa mundial en ese zoom. */
function aPixel(lat: number, lon: number, zoom: number) {
  const mundo = 2 ** zoom * TILE;
  const x = ((lon + 180) / 360) * mundo;
  const rad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * mundo;
  return { x, y };
}

async function bajarMosaico(
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(corte);
  }
}

/** Marcador + atribución. La atribución a OSM es obligatoria por licencia. */
function capaEncima(): Buffer {
  const cx = ANCHO / 2;
  const cy = ALTO / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}">
  <ellipse cx="${cx}" cy="${cy + 2}" rx="9" ry="4" fill="rgba(0,0,0,0.28)"/>
  <g transform="translate(${cx},${cy})">
    <path d="M0,0 C-7,-11 -15,-20 -15,-29 A15,15 0 1,1 15,-29 C15,-20 7,-11 0,0 Z"
          fill="#E53935" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="0" cy="-29" r="5.5" fill="#ffffff"/>
  </g>
  <rect x="${ANCHO - 152}" y="${ALTO - 20}" width="152" height="20" fill="rgba(255,255,255,0.75)"/>
  <text x="${ANCHO - 6}" y="${ALTO - 6}" text-anchor="end"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#333333">© OpenStreetMap</text>
</svg>`;
  return Buffer.from(svg);
}

/**
 * Devuelve el JPEG en base64 (sin prefijo `data:`), o `null` si no se pudo
 * armar. Nunca lanza: el que llama debe poder seguir con otro formato de
 * mensaje si el mapa no salió.
 */
export async function generarMapaConPin(
  lat: number,
  lon: number,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;

  try {
    const centro = aPixel(lat, lon, ZOOM);
    // Ventana de recorte en píxeles absolutos, centrada en el punto.
    const izq = Math.round(centro.x - ANCHO / 2);
    const arr = Math.round(centro.y - ALTO / 2);

    const mx0 = Math.floor(izq / TILE);
    const my0 = Math.floor(arr / TILE);
    const mx1 = Math.floor((izq + ANCHO - 1) / TILE);
    const my1 = Math.floor((arr + ALTO - 1) / TILE);

    const columnas = mx1 - mx0 + 1;
    const filas = my1 - my0 + 1;
    if (columnas * filas > MAX_MOSAICOS) return null;

    const limite = 2 ** ZOOM;
    const pedidos: Promise<{ dx: number; dy: number; png: Buffer | null }>[] =
      [];
    for (let my = my0; my <= my1; my++) {
      // Fuera del rango vertical del mundo no hay mosaico; se deja en blanco.
      if (my < 0 || my >= limite) continue;
      for (let mx = mx0; mx <= mx1; mx++) {
        // Horizontalmente el mundo da la vuelta (antimeridiano).
        const mxEnv = ((mx % limite) + limite) % limite;
        pedidos.push(
          bajarMosaico(ZOOM, mxEnv, my).then((png) => ({
            dx: (mx - mx0) * TILE,
            dy: (my - my0) * TILE,
            png,
          })),
        );
      }
    }

    const mosaicos = await Promise.all(pedidos);
    const utiles = mosaicos.filter((m) => m.png != null);
    // Con menos de la mitad el mapa sale demasiado agujereado para servir.
    if (utiles.length === 0 || utiles.length < mosaicos.length / 2) return null;

    const lienzo = await sharp({
      create: {
        width: columnas * TILE,
        height: filas * TILE,
        channels: 3,
        background: { r: 233, g: 231, b: 226 },
      },
    })
      .composite(
        utiles.map((m) => ({ input: m.png as Buffer, top: m.dy, left: m.dx })),
      )
      .png()
      .toBuffer();

    const jpeg = await sharp(lienzo)
      .extract({
        left: izq - mx0 * TILE,
        top: arr - my0 * TILE,
        width: ANCHO,
        height: ALTO,
      })
      .composite([{ input: capaEncima(), top: 0, left: 0 }])
      .jpeg({ quality: 82 })
      .toBuffer();

    return jpeg.toString('base64');
  } catch (e: any) {
    logger.warn(`No se pudo armar el mapa: ${String(e?.stack ?? e?.message ?? e)}`);
    return null;
  }
}
