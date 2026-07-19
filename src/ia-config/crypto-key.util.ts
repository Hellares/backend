import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Cifrado simétrico para las API keys de proveedor propio (BYOK). Nunca se
 * guardan en plaintext: la empresa las entrega, se cifran en reposo y solo el
 * ejecutor del agente las descifra en memoria para hacer la llamada al LLM.
 *
 * Clave maestra: process.env.IA_KEY_SECRET (cualquier string; se deriva a 32
 * bytes con SHA-256). AES-256-GCM → confidencialidad + autenticidad.
 * Formato guardado: enc:v1:<iv_hex>:<tag_hex>:<cipher_hex>.
 */
const PREFIJO = 'enc:v1:';

function claveMaestra(): Buffer {
  const secreto = process.env.IA_KEY_SECRET;
  if (!secreto) {
    throw new Error('Falta IA_KEY_SECRET para cifrar la API key del proveedor');
  }
  return createHash('sha256').update(secreto).digest(); // 32 bytes
}

/** Cifra un secreto en plaintext. Devuelve el formato enc:v1:iv:tag:cipher. */
export function cifrarSecreto(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', claveMaestra(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIJO}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** True si el valor guardado tiene el formato cifrado esperado. */
export function esCifrado(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIJO);
}

/** Descifra un secreto cifrado con {@link cifrarSecreto}. */
export function descifrarSecreto(guardado: string): string {
  if (!esCifrado(guardado)) {
    // Compatibilidad: si por alguna razón quedó en claro, se devuelve tal cual.
    return guardado;
  }
  const [, , ivHex, tagHex, cipherHex] = guardado.split(':');
  const decipher = createDecipheriv('aes-256-gcm', claveMaestra(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
