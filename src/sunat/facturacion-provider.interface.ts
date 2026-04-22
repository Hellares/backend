/**
 * Info de una serie individual del proveedor (normalizada entre proveedores).
 */
export interface SerieProveedorInfo {
  serie: string;                  // "F002"
  tipoDocumento: string;          // "01" | "03" | "07" | "08" | "09"
  tipoDocumentoNombre: string;    // "Factura" | "Boleta" | ...
  tipoUso: string;                // "api" | "web"
  correlativoActual: number;      // último emitido (0 si aún no)
  proximoNumero: string;          // "F002-000001"
}

export interface BranchProveedorInfo {
  branchIdProveedor: string | number;  // ID interno del branch en el proveedor
  codigo: string;                       // "0000"
  nombre: string;                       // "Principal"
  series: SerieProveedorInfo[];
}

export interface ProveedorSeriesInfo {
  branches: BranchProveedorInfo[];
  metadata?: Record<string, any>;      // config extra del proveedor (ej. email activo)
}

/**
 * Resultado genérico de envío/consulta a proveedor de facturación electrónica.
 * Abstrae la respuesta para que el servicio no dependa del proveedor específico.
 */
export interface EnvioResult {
  aceptado: boolean;
  procesando?: boolean;
  yaExiste?: boolean;
  hash?: string | null;
  xmlUrl?: string | null;
  pdfUrl?: string | null;
  cdrUrl?: string | null;
  cadenaQR?: string | null;
  enlace?: string | null;
  error?: string | null;
  rawResponse?: any;
}

/**
 * Interfaz Strategy para proveedores de facturación electrónica.
 * Implementaciones: NubefactProvider, EfactProvider, etc.
 *
 * Para cambiar de proveedor, solo crear una nueva clase que implemente
 * esta interfaz y registrarla en SunatModule.
 */
export interface FacturacionProvider {
  /** Enviar comprobante al proveedor (factura, boleta, nota) */
  enviar(comprobante: any, config: any, comprobanteOrigen?: any): Promise<EnvioResult>;

  /** Consultar estado de un comprobante enviado */
  consultar(comprobante: any, config: any): Promise<EnvioResult>;

  /** Anular comprobante (comunicación de baja) */
  anular(comprobante: any, motivo: string, config: any): Promise<EnvioResult>;

  /** Consultar estado de anulación */
  consultarAnulacion(comprobante: any, config: any): Promise<any>;

  /**
   * Opcional: consultar las series/correlativos registradas en el proveedor.
   * Solo algunos proveedores lo exponen (Syncrofact sí, Nubefact no).
   * Si el método no existe, el service devuelve "no soportado" al usuario.
   */
  obtenerSeries?(config: any): Promise<ProveedorSeriesInfo>;

  /**
   * Opcional: consulta masiva del estado SUNAT de múltiples comprobantes
   * por sus referencias internas. Reduce N requests a 1 (o pocas con chunking).
   * El caller debe agrupar por tipo_documento antes de llamar.
   */
  batchStatus?(
    params: { tipoDocumento: string; referencias: string[] },
    config: any,
  ): Promise<BatchStatusResult[]>;
}

/** Resultado por referencia interna en una consulta batch */
export interface BatchStatusResult {
  referenciaInterna: string;
  encontrado: boolean;
  numeroCompleto?: string;      // "F002-00000002"
  estadoSunat?: string;          // "ACEPTADO" | "RECHAZADO" | "PROCESANDO" | ...
  total?: number;
  /** raw del proveedor por si el caller quiere hash, urls, etc. */
  raw?: any;
}

/** Token de inyección para el provider de facturación */
export const FACTURACION_PROVIDER = 'FACTURACION_PROVIDER';
