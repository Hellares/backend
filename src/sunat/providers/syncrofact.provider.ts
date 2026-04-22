import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../common/logger/logger.service';
import { FacturacionProvider, EnvioResult, ProveedorSeriesInfo, BatchStatusResult } from '../facturacion-provider.interface';
import { SyncrofactMapper } from './syncrofact.mapper';
import {
  SYNCROFACT_TIMEOUT_MS,
  SYNCROFACT_ENDPOINTS,
  SYNCROFACT_RESOURCE,
  ESTADOS_TERMINALES,
  SyncrofactCreateResponse,
  SyncrofactDocumentData,
} from './syncrofact.types';

@Injectable()
export class SyncrofactProvider implements FacturacionProvider {
  private readonly logger: AppLoggerService;

  constructor(loggerService: AppLoggerService) {
    this.logger = loggerService;
    this.logger.setContext('SyncrofactProvider');
  }

  async enviar(comprobante: any, config: any, comprobanteOrigen?: any): Promise<EnvioResult> {
    const tipo = comprobante.tipoComprobante;
    const endpoint = SYNCROFACT_ENDPOINTS[tipo];
    if (!endpoint) {
      return { aceptado: false, error: `Tipo de comprobante no soportado por Syncrofact: ${tipo}` };
    }

    const esNota = tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO';
    const body = esNota
      ? SyncrofactMapper.toNotaRequest(comprobante, config, comprobanteOrigen)
      : SyncrofactMapper.toInvoiceRequest(comprobante, config);

    const url = this.buildUrl(config.proveedorRuta, endpoint);
    const response = await this.callApi<SyncrofactCreateResponse>(url, config.proveedorToken, body);

    return this.mapCreateResponse(response);
  }

  async consultar(comprobante: any, config: any): Promise<EnvioResult> {
    const tipo = comprobante.tipoComprobante;
    const resource = SYNCROFACT_RESOURCE[tipo];
    if (!resource) {
      return { aceptado: false, error: `Tipo no soportado: ${tipo}` };
    }

    // Recuperar id interno de Syncrofact desde cdrResponse
    const syncrofactId = this.extraerSyncrofactId(comprobante);

    // Sin id: intentar buscar por referencia_interna (id interno del comprobante)
    if (!syncrofactId) {
      const url = this.buildUrl(
        config.proveedorRuta,
        `/v1/integracion/documentos?referencia_interna=${encodeURIComponent(comprobante.id)}&tipo_documento=${this.tipoDocSunat(tipo)}`,
      );
      const result = await this.callApiGet<any>(url, config.proveedorToken);
      if (result?.data?.encontrado && result.data.id) {
        return this.consultarPorId(resource, result.data.id, config);
      }
      return { aceptado: false, error: 'Documento no encontrado en Syncrofact' };
    }

    return this.consultarPorId(resource, syncrofactId, config);
  }

  /**
   * Syncrofact no expone un endpoint de "comunicación de baja" por API.
   * La anulación se realiza emitiendo una Nota de Crédito con motivo 01.
   * Este método queda como no-op para compatibilidad con la interfaz.
   */
  async anular(comprobante: any, motivo: string, _config: any): Promise<EnvioResult> {
    this.logger.warn(
      `Syncrofact no soporta anulación directa. Para anular ${comprobante.codigoGenerado} emita una Nota de Crédito con motivo "${motivo}".`,
    );
    return {
      aceptado: false,
      error:
        'Syncrofact no soporta comunicación de baja. Emita una Nota de Crédito con código de motivo 01 para anular.',
    };
  }

  async consultarAnulacion(_comprobante: any, _config: any): Promise<any> {
    return {
      success: false,
      message: 'Syncrofact no soporta consulta de anulación. Use Notas de Crédito para anular.',
    };
  }

  /**
   * Consulta las series con tipo_uso=api disponibles para la empresa.
   * Endpoint: GET /v1/integracion/series-correlativos?tipo_uso=api
   */
  async obtenerSeries(config: any): Promise<ProveedorSeriesInfo> {
    const url = this.buildUrl(
      config.proveedorRuta,
      '/v1/integracion/series-correlativos?tipo_uso=api',
    );
    const response = await this.callApiGet<any>(url, config.proveedorToken);

    if (!response?.success) {
      throw new Error(response?.message || 'Syncrofact: respuesta inválida consultando series');
    }

    const data = response.data || {};
    const branches = Array.isArray(data.branches) ? data.branches : [];

    return {
      branches: branches.map((b: any) => ({
        branchIdProveedor: b.branch_id,
        codigo: String(b.codigo ?? ''),
        nombre: String(b.nombre ?? ''),
        series: Array.isArray(b.series)
          ? b.series.map((s: any) => ({
              serie: String(s.serie),
              tipoDocumento: String(s.tipo_documento),
              tipoDocumentoNombre: String(s.tipo_documento_nombre ?? ''),
              tipoUso: String(s.tipo_uso ?? 'api'),
              correlativoActual: Number(s.correlativo_actual ?? 0),
              proximoNumero: String(s.proximo_numero ?? ''),
            }))
          : [],
      })),
      metadata: data.config ?? undefined,
    };
  }

  /**
   * Consulta masiva del estado SUNAT de múltiples comprobantes por referencia_interna.
   * Endpoint: POST /v1/integracion/batch-status (límite del proveedor: 50 referencias por request).
   * El caller es responsable de hacer el chunking si pasa más de 50.
   */
  async batchStatus(
    params: { tipoDocumento: string; referencias: string[] },
    config: any,
  ): Promise<BatchStatusResult[]> {
    if (!params.referencias?.length) return [];
    if (params.referencias.length > 50) {
      throw new Error('Syncrofact batch-status acepta máximo 50 referencias por request');
    }

    const url = this.buildUrl(config.proveedorRuta, '/v1/integracion/batch-status');
    const response = await this.callApi<any>(url, config.proveedorToken, {
      tipo_documento: params.tipoDocumento,
      referencias: params.referencias,
    });

    if (!response?.success) {
      throw new Error(response?.message || 'Syncrofact batch-status: respuesta inválida');
    }

    const data = Array.isArray(response.data) ? response.data : [];
    return data.map((item: any) => ({
      referenciaInterna: String(item.referencia_interna ?? ''),
      encontrado: item.encontrado === true,
      numeroCompleto: item.numero_completo ?? undefined,
      estadoSunat: item.estado_sunat ?? undefined,
      total: typeof item.total === 'number' ? item.total : undefined,
      raw: item,
    }));
  }

  // ── Helpers del provider ──

  private async consultarPorId(resource: string, id: number, config: any): Promise<EnvioResult> {
    const url = this.buildUrl(config.proveedorRuta, `/v1/${resource}/${id}`);
    const response = await this.callApiGet<SyncrofactCreateResponse>(url, config.proveedorToken);
    return this.mapCreateResponse(response);
  }

  private mapCreateResponse(response: SyncrofactCreateResponse): EnvioResult {
    if (!response?.success || !response.data) {
      return {
        aceptado: false,
        error: response?.message || 'Respuesta inválida del proveedor',
        rawResponse: response,
      };
    }

    const data = response.data;
    const estado = (data.estado_sunat || '').toUpperCase();
    const esTerminal = ESTADOS_TERMINALES.has(estado);
    const aceptado = estado === 'ACEPTADO';
    const yaExiste = response.idempotent === true;

    const base = {
      hash: data.codigo_hash ?? this.extraerHashDeRespuesta(data) ?? null,
      xmlUrl: data.xml_url ?? null,
      pdfUrl: data.pdf_url ?? null,
      cdrUrl: data.cdr_url ?? null,
      cadenaQR: data.cadena_qr ?? null,
      enlace: data.consulta_url ?? null,
      rawResponse: this.enriquecerRaw(response),
    };

    if (aceptado) {
      return { aceptado: true, yaExiste, ...base };
    }

    if (estado === 'RECHAZADO') {
      return {
        aceptado: false,
        error: data.respuesta_sunat?.descripcion || 'Rechazado por SUNAT',
        ...base,
      };
    }

    if (estado === 'ERROR') {
      return {
        aceptado: false,
        error: data.respuesta_sunat?.descripcion || response.message || 'Error en el procesamiento',
        ...base,
      };
    }

    // EN_COLA, ENVIANDO, PROCESANDO, PENDIENTE → procesando
    if (!esTerminal) {
      return { aceptado: false, procesando: true, ...base };
    }

    return { aceptado: false, error: `Estado SUNAT: ${estado}`, ...base };
  }

  /** Inyecta el syncrofactId en el raw para persistirlo y consultarlo luego */
  private enriquecerRaw(response: SyncrofactCreateResponse) {
    return {
      ...response,
      _syncrofactId: response.data?.id,
    };
  }

  private extraerSyncrofactId(comprobante: any): number | null {
    const raw = comprobante.cdrResponse;
    if (!raw) return null;
    if (typeof raw._syncrofactId === 'number') return raw._syncrofactId;
    if (raw.data?.id && typeof raw.data.id === 'number') return raw.data.id;
    return null;
  }

  private extraerHashDeRespuesta(_data: SyncrofactDocumentData): string | null {
    return null;
  }

  private tipoDocSunat(tipoInterno: string): string {
    switch (tipoInterno) {
      case 'FACTURA': return '01';
      case 'BOLETA': return '03';
      case 'NOTA_CREDITO': return '07';
      case 'NOTA_DEBITO': return '08';
      case 'GUIA_REMISION': return '09';
      default: return '01';
    }
  }

  private buildUrl(base: string, path: string): string {
    if (!base) throw new Error('proveedorRuta (base URL) no configurada para Syncrofact');
    const b = base.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
  }

  // ── HTTP ──

  private async callApi<T = any>(url: string, token: string, body: any): Promise<T> {
    return this.doFetch<T>(url, token, 'POST', body);
  }

  private async callApiGet<T = any>(url: string, token: string): Promise<T> {
    return this.doFetch<T>(url, token, 'GET');
  }

  private async doFetch<T = any>(url: string, token: string, method: 'GET' | 'POST', body?: any): Promise<T> {
    if (!token) throw new Error('proveedorToken no configurado para Syncrofact');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNCROFACT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Timeout: Syncrofact no respondió');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Respuesta no válida de Syncrofact: HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      const msg = this.extraerError(data) || `HTTP ${response.status}`;
      // Duplicado de correlativo: devolverlo tal cual para que el mapper lo interprete
      if (data?.message?.toLowerCase?.().includes('ya existe')) {
        return data as T;
      }
      throw new Error(msg);
    }

    return data as T;
  }

  private extraerError(data: any): string | null {
    if (!data) return null;
    if (typeof data.message === 'string' && data.message) {
      if (data.errors && typeof data.errors === 'object') {
        const detalles = Object.entries(data.errors)
          .map(([campo, msgs]) => `${campo}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
          .join(' | ');
        return detalles ? `${data.message} - ${detalles}` : data.message;
      }
      return data.message;
    }
    return null;
  }
}
