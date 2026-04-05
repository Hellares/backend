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
}

/** Token de inyección para el provider de facturación */
export const FACTURACION_PROVIDER = 'FACTURACION_PROVIDER';
