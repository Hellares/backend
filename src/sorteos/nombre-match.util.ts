/**
 * Match de nombres para pagos Yape/Plin — compartido entre SorteosService
 * (sugerencias + auto-validación) y el bot de WhatsApp (yape anticipado).
 * SIN dependencias: evita el ciclo bot → sorteos.service → whatsapp.service.
 */

/**
 * ¿El nombre de la notificación de Yape/Plin corresponde a esta persona?
 * Yape manda el nombre PARCIAL ("SEBASTIANA C." = nombres + inicial del
 * apellido); Plin a veces completo. Regla: cada token del sender debe
 * calzar EN ORDEN contra las palabras del nombre completo — palabra
 * exacta (puede saltar segundos nombres), o inicial (1 letra) que calce
 * con la palabra INMEDIATA (si saltara, "R." matchearía el apellido
 * materno de otra persona).
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
      .replace(/[^A-ZÑ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const st = norm(sender).split(' ').filter(Boolean);
  const ct = norm(nombreCompleto).split(' ').filter(Boolean);
  if (st.length === 0 || ct.length === 0) return false;
  // Solo iniciales no identifican a nadie.
  if (st.every((t) => t.length === 1)) return false;
  let i = 0;
  for (const t of st) {
    if (t.length === 1) {
      if (i >= ct.length || !ct[i].startsWith(t)) return false;
      i++;
      continue;
    }
    let ok = false;
    while (i < ct.length) {
      const w = ct[i++];
      if (w === t) {
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
