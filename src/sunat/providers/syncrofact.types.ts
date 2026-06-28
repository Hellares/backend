// ── Constantes ──

export const SYNCROFACT_TIMEOUT_MS = 30_000;

/** Longitudes de documentos SUNAT */
export const DOC_LENGTH = { RUC: 11, DNI: 8 } as const;

/** Códigos SUNAT tipo de documento de identidad (sin mapeo, son directos) */
export const TIPO_DOC_SUNAT = {
  OTROS: '0',
  DNI: '1',
  CE: '4',
  RUC: '6',
  PASAPORTE: '7',
} as const;

/** Tipo comprobante interno → código SUNAT catálogo 01 */
export const TIPO_COMPROBANTE_SUNAT: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
  GUIA_REMISION: '09',
};

/** Endpoints por tipo de comprobante (relativos al base URL) */
export const SYNCROFACT_ENDPOINTS: Record<string, string> = {
  FACTURA: '/v1/invoices',
  BOLETA: '/v1/boletas',
  NOTA_CREDITO: '/v1/credit-notes',
  NOTA_DEBITO: '/v1/debit-notes',
  GUIA_REMISION: '/v1/dispatch-guides',
};

/** Segmento de ruta en downloads/consultas por tipo */
export const SYNCROFACT_RESOURCE: Record<string, string> = {
  FACTURA: 'invoices',
  BOLETA: 'boletas',
  NOTA_CREDITO: 'credit-notes',
  NOTA_DEBITO: 'debit-notes',
  GUIA_REMISION: 'dispatch-guides',
};

/** Mapeo del tipo del comprobante origen (para notas) → código doc afectado SUNAT */
export const TIPO_DOC_AFECTADO: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
};

export const IGV_DEFAULT = 18;

/** Estados SUNAT terminales: ya no se va a consultar más */
export const ESTADOS_TERMINALES = new Set(['ACEPTADO', 'RECHAZADO', 'ERROR']);

/** Config específica de Syncrofact guardada en JSON */
export interface SyncrofactProveedorConfig {
  companyId: number;
  branchId: number;
}

// ── Request: Cliente (común a todos) ──

export interface SyncrofactClient {
  tipo_documento: string;
  numero_documento: string;
  razon_social: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  ubigeo?: string;
}

// ── Request: Item (común a todos) ──

export interface SyncrofactItem {
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  mto_valor_unitario?: number;
  mto_precio_unitario?: number;
  tip_afe_igv: string;
  porcentaje_igv: number;
  icbper?: number;
}

// ── Request: Cuota de crédito ──

export interface SyncrofactCuota {
  moneda: string;
  monto: number;
  fecha_pago: string;
}

// ── Request: Medio de pago (bancarización Ley 28194) ──

export interface SyncrofactMedioPago {
  tipo: string;                  // EFEC, YAPE, PLIN, POS, TRAN, etc.
  entidad_financiera?: string;   // Requerido para medios bancarios (POS, TRAN, BANCA_*)
  referencia?: string;           // N° operación/transacción (requerido para medios que no son efectivo)
  fecha_operacion?: string;      // YYYY-MM-DD (requerido según catálogo)
  monto: number;                 // Debe cubrir mto_imp_venta sumado entre medios
}

/** Umbrales Ley 28194 */
export const UMBRAL_BANCARIZACION = {
  PEN: 2000,
  USD: 500,
} as const;

/**
 * Mapeo del enum interno MetodoPagoVenta → código Syncrofact del catálogo
 * `/v1/bancarizacion/medios-pago`.
 * CREDITO no aplica (usa forma_pago_cuotas).
 */
export const METODO_PAGO_MAP: Record<string, string> = {
  EFECTIVO: 'EFEC',
  YAPE: 'YAPE',
  PLIN: 'PLIN',
  TARJETA: 'POS',
  TRANSFERENCIA: 'TRAN',
};

/** Medios de pago que NO requieren referencia ni banco (solo EFECTIVO hoy) */
export const MEDIOS_SIN_REFERENCIA = new Set(['EFEC']);

/** Medios de pago que requieren entidad_financiera además de referencia */
export const MEDIOS_REQUIEREN_BANCO = new Set(['POS', 'TRAN', 'BANCA_WEB', 'BANCA_APP', 'DEPO', 'CHEQ', 'GIRO']);

// ── Request: Factura/Boleta ──

export interface SyncrofactInvoiceRequest {
  company_id: number;
  branch_id: number;
  serie: string;
  correlativo?: number;
  referencia_interna?: string;
  fecha_emision: string;
  fecha_vencimiento?: string;
  tipo_operacion?: string;
  moneda: string;
  tipo_cambio?: number;
  forma_pago_tipo: 'Contado' | 'Credito';
  forma_pago_cuotas?: SyncrofactCuota[];
  medios_pago?: SyncrofactMedioPago[];
  metodo_envio?: 'individual' | 'resumen_diario';
  observaciones?: string;
  client: SyncrofactClient;
  detalles: SyncrofactItem[];
}

// ── Request: Notas ──

export interface SyncrofactNotaRequest extends Omit<SyncrofactInvoiceRequest, 'forma_pago_tipo' | 'forma_pago_cuotas'> {
  tipo_doc_afectado: string;
  num_doc_afectado: string;
  cod_motivo: string;
  des_motivo: string;
  forma_pago_tipo?: 'Contado' | 'Credito';
}

// ── Response: Crear documento ──

export interface SyncrofactCreateResponse {
  success: boolean;
  message?: string;
  idempotent?: boolean;
  warning?: string;
  data: SyncrofactDocumentData;
}

export interface SyncrofactDocumentData {
  id: number;
  numero_completo: string;
  serie: string;
  correlativo: string;
  referencia_interna?: string;
  fecha_emision: string;
  moneda: string;
  estado_sunat: string;
  empresa?: { ruc: string; razon_social: string };
  sucursal?: { codigo: string; nombre: string };
  cliente?: { tipo_documento: string; numero_documento: string; razon_social: string };
  totales?: {
    gravada: number;
    exonerada: number;
    inafecta: number;
    igv: number;
    icbper: number;
    total: number;
  };
  consulta_url?: string;
  pdf_url?: string;
  xml_url?: string;
  cdr_url?: string;
  codigo_hash?: string;
  cadena_qr?: string;
  /**
   * Bloque SUNAT que devuelven `InvoiceController@show` / `BoletaController@show`
   * para documentos terminales. Es la llave REAL del contrato (`data.sunat`).
   * Las descripciones pueden venir como `descripcion`/`description`/`message`
   * según la rama que las haya escrito en BD.
   */
  sunat?: {
    codigo?: string;
    code?: string;
    descripcion?: string;
    description?: string;
    message?: string;
    notas?: unknown[];
  };
  /** Forma legacy/alterna (resúmenes, baja). Se mantiene como fallback. */
  respuesta_sunat?: {
    codigo?: string;
    code?: string;
    descripcion?: string;
    description?: string;
    message?: string;
  };
}

// ── Response de error ──

export interface SyncrofactErrorResponse {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
}
