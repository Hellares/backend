// ── Constantes GRE ──

/** Tipo comprobante Nubefact para GRE */
export const GRE_TIPO_COMPROBANTE = {
  REMITENTE: 7,
  TRANSPORTISTA: 8,
} as const;

/** Series DEMO (entorno BETA) de Nubefact para GRE */
export const GRE_SERIE_BETA = {
  REMITENTE: 'TTT1',
  TRANSPORTISTA: 'VVV1',
} as const;

/** Motivo de traslado → código SUNAT (Catálogo 20) */
export const MOTIVO_TRASLADO_MAP: Record<string, string> = {
  VENTA: '01',
  COMPRA: '02',
  VENTA_CON_ENTREGA_A_TERCEROS: '03',
  TRASLADO_ENTRE_ESTABLECIMIENTOS: '04',
  CONSIGNACION: '05',
  DEVOLUCION: '06',
  RECOJO_BIENES_TRANSFORMADOS: '07',
  IMPORTACION: '08',
  EXPORTACION: '09',
  OTROS: '13',
  VENTA_SUJETA_A_CONFIRMACION: '14',
  TRASLADO_BIENES_TRANSFORMACION: '17',
  TRASLADO_EMISOR_ITINERANTE: '18',
};

/** Tipo de transporte → código Nubefact */
export const TIPO_TRANSPORTE_MAP: Record<string, string> = {
  PUBLICO: '01',
  PRIVADO: '02',
};

/** Tipo documento identidad → código Nubefact */
export const TIPO_DOC_MAP: Record<string, string> = {
  RUC: '6',
  DNI: '1',
  CE: '4',
  PASAPORTE: '7',
  CEDULA_DIPLOMATICA: 'A',
  NO_DOMICILIADO: '0',
};

// ── Interfaces request ──

export interface NubefactGreItemRequest {
  unidad_de_medida: string;
  codigo: string;
  descripcion: string;
  cantidad: string;
  codigo_dam?: string;
}

export interface NubefactGreDocRelacionado {
  tipo: string;   // "01"=Factura, "03"=Boleta, "09"=GRE Remitente, "31"=GRE Transportista
  serie: string;
  numero: string;
}

export interface NubefactGreVehiculoSecundario {
  placa_numero: string;
  tuc?: string;
}

export interface NubefactGreConductorSecundario {
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  apellidos: string;
  numero_licencia: string;
}

export interface NubefactGreRequest {
  operacion: 'generar_guia';
  tipo_de_comprobante: number;  // 7=Remitente, 8=Transportista
  serie: string;
  numero: string;

  // Destinatario (Remitente) / Remitente (Transportista)
  cliente_tipo_de_documento: string;
  cliente_numero_de_documento: string;
  cliente_denominacion: string;
  cliente_direccion: string;
  cliente_email: string;
  cliente_email_1: string;
  cliente_email_2: string;

  fecha_de_emision: string;  // DD-MM-AAAA
  observaciones: string;

  // Solo GRE Remitente
  motivo_de_traslado?: string;
  motivo_de_traslado_otros_descripcion?: string;

  peso_bruto_total: string;
  peso_bruto_unidad_de_medida: string;  // KGM o TNE
  numero_de_bultos?: string;

  // Solo GRE Remitente
  tipo_de_transporte?: string;  // "01" o "02"

  fecha_de_inicio_de_traslado: string;  // DD-MM-AAAA

  // Transportista (transporte público)
  transportista_documento_tipo?: string;
  transportista_documento_numero?: string;
  transportista_denominacion?: string;
  transportista_placa_numero: string;

  // TUC vehículo principal (solo GRE Transportista)
  tuc_vehiculo_principal?: string;

  // Conductor principal
  conductor_documento_tipo?: string;
  conductor_documento_numero?: string;
  conductor_nombre?: string;
  conductor_apellidos?: string;
  conductor_numero_licencia?: string;

  // Destinatario (solo GRE Transportista)
  destinatario_documento_tipo?: string;
  destinatario_documento_numero?: string;
  destinatario_denominacion?: string;

  // MTC
  mtc?: string;

  // Indicadores SUNAT
  sunat_envio_indicador?: string;

  // Puntos
  punto_de_partida_ubigeo: string;
  punto_de_partida_direccion: string;
  punto_de_partida_codigo_establecimiento_sunat?: string;
  punto_de_llegada_ubigeo: string;
  punto_de_llegada_direccion: string;
  punto_de_llegada_codigo_establecimiento_sunat?: string;

  // Importación/Exportación
  documento_relacionado_codigo?: string;

  enviar_automaticamente_al_cliente: string;
  formato_de_pdf: string;

  items: NubefactGreItemRequest[];
  documento_relacionado?: NubefactGreDocRelacionado[];
  vehiculos_secundarios?: NubefactGreVehiculoSecundario[];
  conductores_secundarios?: NubefactGreConductorSecundario[];
}

export interface NubefactGreConsultaRequest {
  operacion: 'consultar_guia';
  tipo_de_comprobante: number;
  serie: string;
  numero: string;
}

// ── Interfaces response ──

export interface NubefactGreResponse {
  tipo_de_comprobante: number;
  serie: string;
  numero: number;
  enlace: string;
  aceptada_por_sunat: boolean;
  sunat_description: string | null;
  sunat_note: string | null;
  sunat_responsecode: string | null;
  sunat_soap_error: string | null;
  pdf_zip_base64: string;
  xml_zip_base64: string;
  cdr_zip_base64: string;
  cadena_para_codigo_qr: string;
  enlace_del_pdf: string;
  enlace_del_xml: string;
  enlace_del_cdr: string;
}
