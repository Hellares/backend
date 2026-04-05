/**
 * Utilidades de validación para documentos peruanos (RUC y DNI).
 * Basado en algoritmo oficial de SUNAT para dígito verificador.
 */

const RUC_FACTORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Valida un RUC peruano (11 dígitos + dígito verificador).
 * Prefijos válidos: 10 (persona natural), 15 (gobierno), 17 (no domiciliado), 20 (empresa).
 */
export function validarRuc(ruc: string): { valido: boolean; error?: string } {
  if (!ruc || ruc.length !== 11) {
    return { valido: false, error: 'El RUC debe tener exactamente 11 dígitos' };
  }

  if (!/^\d{11}$/.test(ruc)) {
    return { valido: false, error: 'El RUC solo debe contener números' };
  }

  const prefijo = ruc.substring(0, 2);
  if (!['10', '15', '17', '20'].includes(prefijo)) {
    return { valido: false, error: `RUC con prefijo ${prefijo} no es válido (debe iniciar con 10, 15, 17 o 20)` };
  }

  // Algoritmo de dígito verificador SUNAT
  const digitos = ruc.split('').map(Number);
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    suma += digitos[i] * RUC_FACTORES[i];
  }
  const residuo = 11 - (suma % 11);
  const digitoVerificador = residuo === 10 ? 0 : residuo === 11 ? 1 : residuo;

  if (digitoVerificador !== digitos[10]) {
    return { valido: false, error: 'RUC inválido: dígito verificador no coincide' };
  }

  return { valido: true };
}

/**
 * Valida un DNI peruano (8 dígitos numéricos).
 */
export function validarDni(dni: string): { valido: boolean; error?: string } {
  if (!dni || dni.length !== 8) {
    return { valido: false, error: 'El DNI debe tener exactamente 8 dígitos' };
  }

  if (!/^\d{8}$/.test(dni)) {
    return { valido: false, error: 'El DNI solo debe contener números' };
  }

  return { valido: true };
}

/**
 * Valida documento según tipo de comprobante.
 * FACTURA requiere RUC válido, BOLETA requiere DNI válido.
 */
export function validarDocumentoParaComprobante(
  tipoComprobante: string,
  documento: string | null | undefined,
): { valido: boolean; error?: string } {
  if (tipoComprobante === 'TICKET') return { valido: true };

  if (!documento || documento.trim() === '') {
    return { valido: false, error: `Se requiere documento del cliente para emitir ${tipoComprobante}` };
  }

  const doc = documento.trim();

  if (tipoComprobante === 'FACTURA') {
    return validarRuc(doc);
  }

  if (tipoComprobante === 'BOLETA') {
    // Boleta acepta DNI, RUC o sin documento (< S/ 700)
    if (doc.length === 8) return validarDni(doc);
    if (doc.length === 11) return validarRuc(doc);
    return { valido: true }; // Otros documentos (CE, pasaporte, etc.)
  }

  return { valido: true };
}
