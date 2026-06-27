import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../common/logger/logger.service';
import { FacturacionProvider, EnvioResult } from '../facturacion-provider.interface';
import { NubefactMapper } from './nubefact.mapper';
import {
  NubefactComprobanteResponse,
  NubefactAnulacionResponse,
  NUBEFACT_TIMEOUT_MS,
} from './nubefact.types';

@Injectable()
export class NubefactProvider implements FacturacionProvider {
  private readonly logger: AppLoggerService;

  constructor(loggerService: AppLoggerService) {
    this.logger = loggerService;
    this.logger.setContext('NubefactProvider');
  }

  async enviar(comprobante: any, config: any, comprobanteOrigen?: any): Promise<EnvioResult> {
    const body = NubefactMapper.toNubefactRequest(comprobante, config, comprobanteOrigen);

    const response = await this.callApi<NubefactComprobanteResponse>(
      config.proveedorRuta,
      config.proveedorToken,
      body,
    );

    const esBeta = config.entorno === 'BETA';
    const aceptadoPorSunat = response.aceptada_por_sunat === true;
    const tieneEnlace = !!response.enlace;
    const errorMsg = response.sunat_description || response.sunat_soap_error || '';
    const esYaExiste = errorMsg.toLowerCase().includes('ya existe');

    // Lógica de aceptación: BETA permisivo, PRODUCCION estricto
    if (aceptadoPorSunat || (esBeta && tieneEnlace)) {
      const mapped = NubefactMapper.fromNubefactResponse(response);
      return {
        aceptado: true,
        hash: mapped.sunatHash,
        xmlUrl: mapped.sunatXmlUrl,
        pdfUrl: mapped.sunatPdfUrl,
        cdrUrl: mapped.sunatCdrUrl,
        cadenaQR: mapped.cadenaQR,
        enlace: mapped.enlaceNubefact,
        rawResponse: response,
      };
    }

    if (esYaExiste) {
      return { aceptado: true, yaExiste: true, rawResponse: response };
    }

    if (!aceptadoPorSunat && tieneEnlace && !esBeta) {
      const mapped = NubefactMapper.fromNubefactResponse(response);
      return {
        aceptado: false,
        procesando: true,
        hash: mapped.sunatHash,
        xmlUrl: mapped.sunatXmlUrl,
        pdfUrl: mapped.sunatPdfUrl,
        cdrUrl: mapped.sunatCdrUrl,
        cadenaQR: mapped.cadenaQR,
        enlace: mapped.enlaceNubefact,
        rawResponse: response,
      };
    }

    return {
      aceptado: false,
      error: errorMsg || 'Rechazado por SUNAT',
      errorCode: response.sunat_responsecode ?? null,
      rawResponse: response,
    };
  }

  async consultar(comprobante: any, config: any): Promise<EnvioResult> {
    const body = NubefactMapper.toConsultaRequest(comprobante, 'consultar_comprobante', config.entorno);

    const response = await this.callApi<NubefactComprobanteResponse>(
      config.proveedorRuta,
      config.proveedorToken,
      body,
    );

    if (response.aceptada_por_sunat === true || response.enlace) {
      const mapped = NubefactMapper.fromNubefactResponse(response);
      return {
        aceptado: true,
        hash: mapped.sunatHash,
        xmlUrl: mapped.sunatXmlUrl,
        pdfUrl: mapped.sunatPdfUrl,
        cdrUrl: mapped.sunatCdrUrl,
        cadenaQR: mapped.cadenaQR,
        enlace: mapped.enlaceNubefact,
        rawResponse: response,
      };
    }

    return { aceptado: false, rawResponse: response };
  }

  async anular(comprobante: any, motivo: string, config: any): Promise<EnvioResult> {
    const body = NubefactMapper.toAnulacionRequest(comprobante, motivo, config.entorno);

    const response = await this.callApi<NubefactAnulacionResponse>(
      config.proveedorRuta,
      config.proveedorToken,
      body,
    );

    return { aceptado: true, rawResponse: response };
  }

  async consultarAnulacion(comprobante: any, config: any): Promise<any> {
    const body = NubefactMapper.toConsultaRequest(comprobante, 'consultar_anulacion', config.entorno);

    return this.callApi(config.proveedorRuta, config.proveedorToken, body);
  }

  // ── HTTP client privado ──

  private async callApi<T = any>(ruta: string, token: string, body: any): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NUBEFACT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ruta, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Timeout: proveedor de facturación no respondió');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Respuesta no válida del proveedor: HTTP ${response.status} ${response.statusText}`);
    }

    if (data.aceptada_por_sunat !== undefined || data.enlace || data.sunat_description || data.codigo_hash) {
      return data as T;
    }

    if (!response.ok) {
      const msg = data?.errors || data?.message || `HTTP ${response.status}`;
      if (typeof msg === 'string' && msg.toLowerCase().includes('ya existe')) {
        return { ...data, sunat_description: msg } as T;
      }
      throw new Error(msg);
    }

    return data as T;
  }
}
