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
  return palabras.length >= 2 && nombreCoincideYape(registrado, sender);
}
