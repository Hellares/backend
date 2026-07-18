// ── Constantes de negocio ──

/** Longitudes de documentos SUNAT */
export const DOC_LENGTH = { RUC: 11, DNI: 8, CE: 9 } as const;

/** Código tipo documento SUNAT */
export const TIPO_DOC_SUNAT = { RUC: '6', DNI: '1', CE: '4', VARIOS: '-' } as const;

/** Series BETA de Nubefact (entorno demo) */
export const SERIE_BETA = { FACTURA: 'FFF1', BOLETA: 'BBB1' } as const;

/** Timeout HTTP para llamadas a Nubefact (ms) */
export const NUBEFACT_TIMEOUT_MS = 30_000;

/** Máximo de comprobantes a reenviar en batch */
export const ENVIO_BATCH_SIZE = 50;

/** Máximo de faltantes a retornar en reporte de correlativos */
export const MAX_FALTANTES_REPORTE = 50;

/** Máximo de intentos de envío antes de dejar como permanente */
export const MAX_INTENTOS_ENVIO = 10;

/** IGV por defecto en Perú */
export const IGV_DEFAULT = 18;

// ── Mapeos Nubefact ──

/** Tipo comprobante → código Nubefact */
export const TIPO_COMPROBANTE_MAP: Record<string, number> = {
  FACTURA: 1,
  BOLETA: 2,
  NOTA_CREDITO: 3,
  NOTA_DEBITO: 4,
};

/** SUNAT Cat. 07 (tipoAfectacion) → Nubefact tipo_de_igv */
export const TIPO_IGV_MAP: Record<string, number> = {
  '10': 1,  // Gravado - Operación Onerosa
  '20': 8,  // Exonerado - Operación Onerosa
  '30': 9,  // Inafecto - Operación Onerosa
};

/** Moneda ISO → código Nubefact */
export const MONEDA_MAP: Record<string, number> = {
  PEN: 1,
  USD: 2,
  EUR: 3,
};

export const TIPO_NOTA_CREDITO_MAP: Record<number, string> = {
  1: 'ANULACIÓN DE LA OPERACIÓN',
  2: 'ANULACIÓN POR ERROR EN EL RUC',
  3: 'CORRECCIÓN POR ERROR EN LA DESCRIPCIÓN',
  4: 'DESCUENTO GLOBAL',
  5: 'DESCUENTO POR ÍTEM',
  6: 'DEVOLUCIÓN TOTAL',
  7: 'DEVOLUCIÓN POR ÍTEM',
  8: 'BONIFICACIÓN',
  9: 'DISMINUCIÓN EN EL VALOR',
  10: 'OTROS CONCEPTOS',
};

export const TIPO_NOTA_DEBITO_MAP: Record<number, string> = {
  1: 'INTERESES POR MORA',
  2: 'AUMENTO DE VALOR',
  3: 'PENALIDADES',
};

// ── Interfaces request ──

export interface NubefactItemRequest {
  unidad_de_medida: string;
  codigo: string;
  codigo_producto_sunat?: string;
  descripcion: string;
  cantidad: number;
  valor_unitario: number;
  precio_unitario: number;
  descuento: string;
  subtotal: number;
  tipo_de_igv: number;
  igv: number;
  total: number;
  anticipo_regularizacion: boolean;
  anticipo_documento_serie: string;
  anticipo_documento_numero: string;
  impuesto_bolsas?: number;
}

export interface NubefactVentaCredito {
  cuota: number;
  fecha_de_pago: string;
  importe: number;
}

export interface NubefactComprobanteRequest {
  operacion: string;
  tipo_de_comprobante: number;
  serie: string;
  numero: number;
  sunat_transaction: number;
  cliente_tipo_de_documento: string;
  cliente_numero_de_documento: string;
  cliente_denominacion: string;
  cliente_direccion: string;
  cliente_email: string;
  cliente_email_1: string;
  cliente_email_2: string;
  fecha_de_emision: string;
  fecha_de_vencimiento: string;
  moneda: number;
  tipo_de_cambio: string;
  porcentaje_de_igv: number;
  descuento_global: string;
  total_descuento: string;
  total_anticipo: string;
  total_gravada: number | string;
  total_inafecta: number | string;
  total_exonerada: number | string;
  total_igv: number | string;
  total_gratuita: string;
  total_otros_cargos: string;
  total_impuestos_bolsas: number | string;
  total: number;
  percepcion_tipo: string;
  percepcion_base_imponible: string;
  total_percepcion: string;
  total_incluido_percepcion: string;
  retencion_tipo: string;
  retencion_base_imponible: string;
  total_retencion: string;
  detraccion: boolean;
  observaciones: string;
  documento_que_se_modifica_tipo: number | string;
  documento_que_se_modifica_serie: string;
  documento_que_se_modifica_numero: number | string;
  tipo_de_nota_de_credito: number | string;
  tipo_de_nota_de_debito: number | string;
  enviar_automaticamente_a_la_sunat: boolean;
  enviar_automaticamente_al_cliente: boolean;
  codigo_unico: string;
  condiciones_de_pago: string;
  medio_de_pago: string;
  placa_vehiculo: string;
  orden_compra_servicio: string;
  formato_de_pdf: string;
  items: NubefactItemRequest[];
  guias: any[];
  venta_al_credito: NubefactVentaCredito[];
}

export interface NubefactAnulacionRequest {
  operacion: 'generar_anulacion';
  tipo_de_comprobante: number;
  serie: string;
  numero: number;
  motivo: string;
  codigo_unico: string;
}

export interface NubefactConsultaRequest {
  operacion: 'consultar_comprobante' | 'consultar_anulacion';
  tipo_de_comprobante: number;
  serie: string;
  numero: number;
}

// ── Interfaces response ──

export interface NubefactComprobanteResponse {
  tipo_de_comprobante: number;
  serie: string;
  numero: number;
  enlace: string;
  enlace_del_pdf: string;
  enlace_del_xml: string;
  enlace_del_cdr: string;
  aceptada_por_sunat: boolean;
  sunat_description: string | null;
  sunat_note: string | null;
  sunat_responsecode: string | null;
  sunat_soap_error: string;
  cadena_para_codigo_qr: string;
  codigo_hash: string;
}

export interface NubefactAnulacionResponse {
  numero: number;
  enlace: string;
  sunat_ticket_numero: string;
  aceptada_por_sunat: boolean;
  sunat_description: string | null;
  sunat_note: string | null;
  sunat_responsecode: string | null;
  sunat_soap_error: string;
  enlace_del_pdf: string;
  enlace_del_xml: string;
  enlace_del_cdr: string;
}
