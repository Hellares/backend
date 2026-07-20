/**
 * Match de nombres para pagos Yape/Plin — compartido entre SorteosService
 * (sugerencias + auto-validación) y el bot de WhatsApp (yape anticipado).
 * SIN dependencias: evita el ciclo bot → sorteos.service → whatsapp.service.
 */

/**
 * ¿El nombre de la notificación de Yape/Plin corresponde a esta persona?
 * Yape manda el nombre PARCIAL — en dos formatos vistos en producción:
 *   - "SEBASTIANA C."   → nombres + INICIAL del apellido
 *   - "Geydy Sil*"      → nombres + apellido TRUNCADO con asterisco
 * Plin a veces manda el completo. Regla: cada token del sender debe calzar
 * EN ORDEN contra las palabras del nombre completo:
 *   - palabra exacta → puede saltar segundos nombres;
 *   - truncada "SIL*" (≥2 letras) → prefijo, también puede saltar;
 *   - inicial (1 letra, con o sin asterisco) → prefijo contra la palabra
 *     INMEDIATA (si saltara, "R." matchearía el apellido materno de otra
 *     persona).
 */
export function nombreCoincideYape(
  sender: string | null | undefined,
  nombreCompleto: string | null | undefined,
): boolean {
  if (!sender || !nombreCompleto) return false;
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      // El asterisco SE CONSERVA: marca que Yape truncó la palabra.
      .replace(/[^A-ZÑ* ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  // "SIL*" → {texto:'SIL', truncado:true}. Un "*" suelto no aporta nada.
  const tok = (s: string) =>
    s
      .split(' ')
      .filter(Boolean)
      .map((w) => ({
        texto: w.replace(/\*/g, ''),
        truncado: w.includes('*'),
      }))
      .filter((t) => t.texto.length > 0);
  const st = tok(norm(sender));
  const ct = tok(norm(nombreCompleto)).map((t) => t.texto);
  if (st.length === 0 || ct.length === 0) return false;
  // Solo iniciales no identifican a nadie.
  if (st.every((t) => t.texto.length === 1)) return false;
  let i = 0;
  for (const t of st) {
    // Inicial suelta ("C." / "C*"): solo contra la palabra inmediata.
    if (t.texto.length === 1) {
      if (i >= ct.length || !ct[i].startsWith(t.texto)) return false;
      i++;
      continue;
    }
    let ok = false;
    while (i < ct.length) {
      const w = ct[i++];
      // Truncada por Yape → basta el prefijo ("SIL*" ↔ "SILVANA").
      if (t.truncado ? w.startsWith(t.texto) : w === t.texto) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * Match en AMBAS direcciones: el sender puede traer MENOS palabras que
 * el registro ("Sebastiana C." vs nombre RENIEC completo) o MÁS (Yape
 * manda "James Johel Torres Ledezma" y el bot guardó "James Torres
 * Ledezma"). El sentido inverso exige ≥2 palabras registradas para no
 * matchear por un solo nombre de pila.
 */
export function nombresCoinciden(
  sender: string | null | undefined,
  registrado: string | null | undefined,
): boolean {
  if (nombreCoincideYape(sender, registrado)) return true;
  const palabras = (registrado ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length >= 2 && nombreCoincideYape(registrado, sender)) {
    return true;
  }
  return nombreCoincideDesordenado(sender, registrado);
}

/**
 * TERCER formato visto en producción: el nombre COMPLETO con los apellidos
 * PRIMERO — "SALAS FLORES RAYZA NADIEJDA" vs registro RENIEC "RAYZA NADIEJDA
 * SALAS FLORES" (caso real 07-19: la participante pagó 3 min después de
 * registrarse y quedó pendiente porque el match exige orden). Con ≥3 palabras
 * COMPLETAS idénticas el orden deja de importar: ese conjunto identifica a la
 * persona igual de bien. Regla: ninguna inicial suelta, cada palabra de un
 * lado calza con una palabra DISTINTA del otro (truncada "SIL*" = prefijo), y
 * el lado más corto queda 100% cubierto con ≥3 palabras.
 */
function nombreCoincideDesordenado(
  sender: string | null | undefined,
  registrado: string | null | undefined,
): boolean {
  if (!sender || !registrado) return false;
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-ZÑ* ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const tok = (s: string) =>
    norm(s)
      .split(' ')
      .filter(Boolean)
      .map((w) => ({ texto: w.replace(/\*/g, ''), truncado: w.includes('*') }))
      .filter((t) => t.texto.length >= 2); // iniciales sueltas NO cuentan
  const st = tok(sender);
  const ct = tok(registrado).map((t) => t.texto);
  // El lado corto define la exigencia; con <3 palabras el desorden es riesgoso
  // ("JUAN CARLOS" vs "CARLOS JUAN" podrían ser personas distintas).
  const minimo = Math.min(st.length, ct.length);
  if (minimo < 3) return false;
  const libres = [...ct];
  let cubiertas = 0;
  for (const t of st) {
    const i = libres.findIndex((w) =>
      t.truncado ? w.startsWith(t.texto) : w === t.texto,
    );
    if (i === -1) continue;
    libres.splice(i, 1); // cada palabra registrada se usa UNA vez
    cubiertas++;
  }
  // Todas las palabras del lado corto deben calzar (≥3).
  return cubiertas >= minimo;
}
