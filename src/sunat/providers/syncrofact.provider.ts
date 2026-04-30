import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../common/logger/logger.service';
import {
  FacturacionProvider,
  EnvioResult,
  ProveedorSeriesInfo,
  BatchStatusResult,
  ComunicacionBajaInput,
  ComunicacionBajaResult,
  ResumenDiarioInput,
  ResumenDiarioResult,
} from '../facturacion-provider.interface';
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

  // ── Comunicación de Baja (RA) ──

  /**
   * Crea una Comunicación de Baja en Syncrofact (no la envía a SUNAT aún).
   * Endpoint: POST /v1/voided-documents
   */
  async crearComunicacionBaja(
    input: ComunicacionBajaInput,
    config: any,
  ): Promise<ComunicacionBajaResult> {
    const url = this.buildUrl(config.proveedorRuta, '/v1/voided-documents');
    const body: any = {
      company_id: config.proveedorConfig?.companyId,
      branch_id: config.proveedorConfig?.branchId,
      fecha_referencia: input.fechaReferencia,
      motivo_baja: input.motivoBaja,
      detalles: input.detalles.map((d) => ({
        tipo_documento: d.tipoDocumento,
        serie: d.serie,
        correlativo: d.correlativo,
        motivo_especifico: d.motivoEspecifico,
      })),
    };
    if (input.usuarioCreacion) body.usuario_creacion = input.usuarioCreacion;

    const response = await this.callApi<any>(url, config.proveedorToken, body);
    if (!response?.success || !response.data) {
      throw new Error(response?.message || 'Syncrofact: respuesta inválida creando CDB');
    }
    return this.mapBajaResponse(response.data);
  }

  /**
   * Envía a SUNAT una CDB previamente creada.
   * Endpoint: POST /v1/voided-documents/{id}/send-sunat
   */
  async enviarComunicacionBaja(
    proveedorBajaId: string,
    config: any,
  ): Promise<ComunicacionBajaResult> {
    const url = this.buildUrl(
      config.proveedorRuta,
      `/v1/voided-documents/${encodeURIComponent(proveedorBajaId)}/send-sunat`,
    );
    const response = await this.callApi<any>(url, config.proveedorToken, {});
    if (!response?.success || !response.data) {
      const err = this.extraerError(response) || 'Syncrofact: respuesta inválida enviando CDB';
      throw new Error(err);
    }
    return this.mapBajaResponse(response.data);
  }

  /**
   * Re-consulta el estado de una CDB que quedó en ENVIADO.
   * Endpoint: POST /v1/voided-documents/{id}/check-status
   */
  async consultarComunicacionBaja(
    proveedorBajaId: string,
    config: any,
  ): Promise<ComunicacionBajaResult> {
    const url = this.buildUrl(
      config.proveedorRuta,
      `/v1/voided-documents/${encodeURIComponent(proveedorBajaId)}/check-status`,
    );
    const response = await this.callApi<any>(url, config.proveedorToken, {});
    if (!response?.success || !response.data) {
      throw new Error(response?.message || 'Syncrofact: respuesta inválida consultando CDB');
    }
    return this.mapBajaResponse(response.data);
  }

  // ── Resumen Diario (RC) — anulación de boletas ──

  /**
   * Crea un Resumen Diario de anulación en Syncrofact.
   * Endpoint: POST /v1/boletas/anular-oficialmente
   * Usa formato B (motivo por boleta) — más expresivo que formato A.
   */
  async crearResumenDiario(
    input: ResumenDiarioInput,
    config: any,
  ): Promise<ResumenDiarioResult> {
    const url = this.buildUrl(config.proveedorRuta, '/v1/boletas/anular-oficialmente');
    const body: any = {
      company_id: config.proveedorConfig?.companyId,
      branch_id: config.proveedorConfig?.branchId,
      boletas: input.detalles.map((d) => ({
        id: typeof d.proveedorComprobanteId === 'string'
          ? Number(d.proveedorComprobanteId)
          : d.proveedorComprobanteId,
        motivo: d.motivoEspecifico,
      })),
    };
    if (input.usuarioCreacion) body.usuario_id = Number(input.usuarioCreacion) || undefined;

    const response = await this.callApi<any>(url, config.proveedorToken, body);
    if (!response?.success || !response.data?.summary) {
      throw new Error(response?.message || 'Syncrofact: respuesta inválida creando RC');
    }
    return this.mapResumenResponse(response.data.summary);
  }

  /**
   * Envía a SUNAT un RC previamente creado (auto-consulta estado tras ~2s).
   * Endpoint: POST /v1/daily-summaries/{id}/send-sunat
   */
  async enviarResumenDiario(
    proveedorResumenId: string,
    config: any,
  ): Promise<ResumenDiarioResult> {
    const url = this.buildUrl(
      config.proveedorRuta,
      `/v1/daily-summaries/${encodeURIComponent(proveedorResumenId)}/send-sunat`,
    );
    const response = await this.callApi<any>(url, config.proveedorToken, {});
    if (!response?.success || !response.data) {
      const err = this.extraerError(response) || 'Syncrofact: respuesta inválida enviando RC';
      throw new Error(err);
    }
    return this.mapResumenResponse(response.data);
  }

  /**
   * Re-consulta el estado de un RC por ticket.
   * Endpoint: POST /v1/daily-summaries/{id}/check-status
   */
  async consultarResumenDiario(
    proveedorResumenId: string,
    config: any,
  ): Promise<ResumenDiarioResult> {
    const url = this.buildUrl(
      config.proveedorRuta,
      `/v1/daily-summaries/${encodeURIComponent(proveedorResumenId)}/check-status`,
    );
    const response = await this.callApi<any>(url, config.proveedorToken, {});
    if (!response?.success || !response.data) {
      throw new Error(response?.message || 'Syncrofact: respuesta inválida consultando RC');
    }
    return this.mapResumenResponse(response.data);
  }

  private mapResumenResponse(data: any): ResumenDiarioResult {
    return {
      proveedorResumenId: String(data.id ?? ''),
      numeroCompleto: String(data.numero_completo ?? data.numero ?? ''),
      serie: String(data.serie ?? this.extraerSerieDeNumero(data.numero_completo ?? data.numero) ?? ''),
      correlativo: String(data.correlativo ?? this.extraerCorrelativoDeNumero(data.numero_completo ?? data.numero) ?? ''),
      fechaEmision: String(data.fecha_resumen ?? data.fecha_emision ?? ''),
      estadoSunat: String(data.estado_sunat ?? 'PENDIENTE').toUpperCase(),
      ticket: data.ticket ?? null,
      hashCdr: data.hash_cdr ?? null,
      errorProveedor:
        typeof data.respuesta_sunat === 'object' && data.respuesta_sunat?.description
          ? data.respuesta_sunat.description
          : null,
      cdrUrl: data.cdr_path ?? data.cdr_url ?? null,
      xmlUrl: data.xml_path ?? data.xml_url ?? null,
      rawResponse: data,
    };
  }

  /** Extrae "RC-20260429" de "RC-20260429-001" (Syncrofact a veces no manda serie/correlativo separados). */
  private extraerSerieDeNumero(numero?: string | null): string | null {
    if (!numero) return null;
    const idx = numero.lastIndexOf('-');
    return idx > 0 ? numero.slice(0, idx) : null;
  }

  private extraerCorrelativoDeNumero(numero?: string | null): string | null {
    if (!numero) return null;
    const idx = numero.lastIndexOf('-');
    return idx > 0 ? numero.slice(idx + 1) : null;
  }

  private mapBajaResponse(data: any): ComunicacionBajaResult {
    return {
      proveedorBajaId: String(data.id ?? ''),
      numeroCompleto: String(data.numero_completo ?? data.numero ?? ''),
      serie: String(data.serie ?? ''),
      correlativo: String(data.correlativo ?? ''),
      fechaEmision: String(data.fecha_emision ?? ''),
      estadoSunat: String(data.estado_sunat ?? 'PENDIENTE').toUpperCase(),
      ticket: data.ticket ?? null,
      hashCdr: data.hash_cdr ?? null,
      errorProveedor:
        typeof data.respuesta_sunat === 'object' && data.respuesta_sunat?.descripcion
          ? data.respuesta_sunat.descripcion
          : null,
      cdrUrl: data.cdr_path ?? data.cdr_url ?? null,
      xmlUrl: data.xml_path ?? data.xml_url ?? null,
      rawResponse: data,
    };
  }

  // ── Recuperación de IDs ──

  /**
   * Resuelve el ID interno de Syncrofact para un comprobante a partir de su
   * `referencia_interna` (= ComprobanteElectronico.id local). Útil cuando el
   * `cdrResponse` no quedó persistido (rama PROCESANDO antigua, etc.).
   *
   * Endpoint: GET /v1/integracion/documentos?referencia_interna=X&tipo_documento=03
   */
  async resolverProveedorIdPorReferencia(
    referenciaInterna: string,
    tipoComprobante: string,
    config: any,
  ): Promise<string | null> {
    const tipoDoc = this.tipoDocSunat(tipoComprobante);
    const url = this.buildUrl(
      config.proveedorRuta,
      `/v1/integracion/documentos?referencia_interna=${encodeURIComponent(referenciaInterna)}&tipo_documento=${tipoDoc}`,
    );
    try {
      const result = await this.callApiGet<any>(url, config.proveedorToken);
      if (result?.data?.encontrado && result.data.id) {
        return String(result.data.id);
      }
      return null;
    } catch (err: any) {
      this.logger.warn(
        `resolverProveedorIdPorReferencia falló para ${referenciaInterna}: ${err?.message ?? err}`,
      );
      return null;
    }
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
