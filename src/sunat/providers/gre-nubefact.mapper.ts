import {
  GRE_TIPO_COMPROBANTE,
  GRE_SERIE_BETA,
  MOTIVO_TRASLADO_MAP,
  TIPO_TRANSPORTE_MAP,
  NubefactGreRequest,
  NubefactGreConsultaRequest,
  NubefactGreItemRequest,
  NubefactGreDocRelacionado,
  NubefactGreVehiculoSecundario,
  NubefactGreConductorSecundario,
  NubefactGreResponse,
} from './gre-nubefact.types';

/** Formatea fecha Date → DD-MM-AAAA en hora Perú (formato Nubefact) */
function formatFechaNubefact(date: Date): string {
  const d = new Date(date);
  // Usar timezone America/Lima para evitar desfases UTC
  const parts = d.toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).split('/');
  // toLocaleDateString('es-PE') retorna DD/MM/YYYY
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

/** Resuelve serie BETA según tipo y entorno */
function resolverSerie(guia: any, entorno: string): string {
  if (entorno === 'BETA') {
    return guia.tipo === 'REMITENTE'
      ? GRE_SERIE_BETA.REMITENTE
      : GRE_SERIE_BETA.TRANSPORTISTA;
  }
  return guia.serie;
}

export class GreNubefactMapper {

  /**
   * Transforma GuiaRemision (BD) → JSON Nubefact para generar_guia
   */
  static toGreRequest(guia: any, entorno: string): NubefactGreRequest {
    const esRemitente = guia.tipo === 'REMITENTE';
    const tipoComprobante = esRemitente
      ? GRE_TIPO_COMPROBANTE.REMITENTE
      : GRE_TIPO_COMPROBANTE.TRANSPORTISTA;

    const serie = resolverSerie(guia, entorno);

    const request: NubefactGreRequest = {
      operacion: 'generar_guia',
      tipo_de_comprobante: tipoComprobante,
      serie,
      numero: String(guia.correlativo),

      // Destinatario/Remitente
      cliente_tipo_de_documento: guia.clienteTipoDocumento,
      cliente_numero_de_documento: guia.clienteNumeroDocumento,
      cliente_denominacion: guia.clienteDenominacion,
      cliente_direccion: guia.clienteDireccion || '',
      cliente_email: guia.clienteEmail || '',
      cliente_email_1: '',
      cliente_email_2: '',

      // Fecha emisión: usar hoy en hora Perú para evitar desfases
      fecha_de_emision: formatFechaNubefact(new Date()),
      observaciones: guia.observaciones || '',

      peso_bruto_total: String(guia.pesoBrutoTotal),
      peso_bruto_unidad_de_medida: guia.pesoBrutoUnidadMedida || 'KGM',

      // Fecha inicio traslado: si es anterior a hoy, usar hoy
      fecha_de_inicio_de_traslado: formatFechaNubefact(
        new Date(guia.fechaInicioTraslado) < new Date() ? new Date() : guia.fechaInicioTraslado,
      ),

      // Placa obligatoria siempre
      transportista_placa_numero: guia.transportistaPlacaNumero || '',

      // Puntos
      punto_de_partida_ubigeo: guia.puntoPartidaUbigeo,
      punto_de_partida_direccion: guia.puntoPartidaDireccion,
      punto_de_partida_codigo_establecimiento_sunat: guia.puntoPartidaCodigoEstablecimientoSunat || '',
      punto_de_llegada_ubigeo: guia.puntoLlegadaUbigeo,
      punto_de_llegada_direccion: guia.puntoLlegadaDireccion,
      punto_de_llegada_codigo_establecimiento_sunat: guia.puntoLlegadaCodigoEstablecimientoSunat || '',

      enviar_automaticamente_al_cliente: guia.clienteEmail ? 'true' : 'false',
      formato_de_pdf: '',

      items: this.buildItems(guia.detalles || []),
    };

    // Campos solo GRE Remitente
    if (esRemitente) {
      request.motivo_de_traslado = MOTIVO_TRASLADO_MAP[guia.motivoTraslado] || '13';
      if (guia.motivoTraslado === 'OTROS' && guia.motivoTrasladoOtrosDescripcion) {
        request.motivo_de_traslado_otros_descripcion = guia.motivoTrasladoOtrosDescripcion;
      }
      request.numero_de_bultos = guia.numeroBultos ? String(guia.numeroBultos) : undefined;
      request.tipo_de_transporte = guia.tipoTransporte
        ? TIPO_TRANSPORTE_MAP[guia.tipoTransporte]
        : '02';
    }

    // Transportista (transporte público)
    if (guia.tipoTransporte === 'PUBLICO' && esRemitente) {
      request.transportista_documento_tipo = guia.transportistaDocumentoTipo || '6';
      request.transportista_documento_numero = guia.transportistaDocumentoNumero || '';
      request.transportista_denominacion = guia.transportistaDenominacion || '';
    }

    // Conductor (transporte privado o GRE Transportista)
    if (guia.tipoTransporte === 'PRIVADO' || !esRemitente) {
      request.conductor_documento_tipo = guia.conductorDocumentoTipo || '';
      request.conductor_documento_numero = guia.conductorDocumentoNumero || '';
      request.conductor_nombre = guia.conductorNombre || '';
      request.conductor_apellidos = guia.conductorApellidos || '';
      request.conductor_numero_licencia = guia.conductorNumeroLicencia || '';
    }

    // TUC vehículo principal (GRE Transportista)
    if (!esRemitente && guia.tucVehiculoPrincipal) {
      request.tuc_vehiculo_principal = guia.tucVehiculoPrincipal;
    }

    // Destinatario (solo GRE Transportista)
    if (!esRemitente) {
      request.destinatario_documento_tipo = guia.destinatarioDocumentoTipo || '';
      request.destinatario_documento_numero = guia.destinatarioDocumentoNumero || '';
      request.destinatario_denominacion = guia.destinatarioDenominacion || '';
    }

    // MTC
    if (guia.transportistaMtc) {
      request.mtc = guia.transportistaMtc;
    }

    // Indicador SUNAT
    if (guia.sunatEnvioIndicador) {
      request.sunat_envio_indicador = guia.sunatEnvioIndicador;
    }

    // Documento relacionado importación/exportación
    if (guia.documentoRelacionadoCodigo) {
      request.documento_relacionado_codigo = guia.documentoRelacionadoCodigo;
    }

    // Documentos relacionados (facturas, boletas, etc.)
    if (guia.documentosRelacionados?.length) {
      request.documento_relacionado = this.buildDocumentosRelacionados(guia.documentosRelacionados);
    }

    // Vehículos secundarios
    if (guia.vehiculosSecundarios?.length) {
      request.vehiculos_secundarios = this.buildVehiculosSecundarios(guia.vehiculosSecundarios);
    }

    // Conductores secundarios
    if (guia.conductoresSecundarios?.length) {
      request.conductores_secundarios = this.buildConductoresSecundarios(guia.conductoresSecundarios);
    }

    return request;
  }

  /**
   * Construye request para consultar_guia
   */
  static toConsultaRequest(guia: any, entorno: string): NubefactGreConsultaRequest {
    const esRemitente = guia.tipo === 'REMITENTE';
    return {
      operacion: 'consultar_guia',
      tipo_de_comprobante: esRemitente
        ? GRE_TIPO_COMPROBANTE.REMITENTE
        : GRE_TIPO_COMPROBANTE.TRANSPORTISTA,
      serie: resolverSerie(guia, entorno),
      numero: String(guia.correlativo),
    };
  }

  /**
   * Mapea la respuesta de Nubefact a campos BD
   */
  static fromGreResponse(response: NubefactGreResponse) {
    return {
      sunatHash: null, // GRE no retorna hash
      sunatXmlUrl: response.enlace_del_xml || null,
      sunatPdfUrl: response.enlace_del_pdf || null,
      sunatCdrUrl: response.enlace_del_cdr || null,
      cadenaQR: response.cadena_para_codigo_qr || null,
      enlaceProveedor: response.enlace || null,
    };
  }

  // ── Builders privados ──

  private static buildItems(detalles: any[]): NubefactGreItemRequest[] {
    return detalles.map((d, index) => {
      const item: NubefactGreItemRequest = {
        unidad_de_medida: d.unidadMedida || 'NIU',
        codigo: d.codigo || d.producto?.codigoEmpresa || `ITEM${String(index + 1).padStart(3, '0')}`,
        descripcion: d.descripcion,
        cantidad: String(d.cantidad),
      };
      if (d.codigoDam) {
        item.codigo_dam = d.codigoDam;
      }
      return item;
    });
  }

  private static buildDocumentosRelacionados(docs: any[]): NubefactGreDocRelacionado[] {
    return docs.map((d) => ({
      tipo: d.tipo,
      serie: d.serie,
      numero: String(d.numero),
    }));
  }

  private static buildVehiculosSecundarios(vehiculos: any[]): NubefactGreVehiculoSecundario[] {
    return vehiculos.slice(0, 2).map((v) => {
      const vs: NubefactGreVehiculoSecundario = { placa_numero: v.placaNumero };
      if (v.tuc) vs.tuc = v.tuc;
      return vs;
    });
  }

  private static buildConductoresSecundarios(conductores: any[]): NubefactGreConductorSecundario[] {
    return conductores.slice(0, 2).map((c) => ({
      documento_tipo: c.documentoTipo,
      documento_numero: c.documentoNumero,
      nombre: c.nombre,
      apellidos: c.apellidos,
      numero_licencia: c.numeroLicencia,
    }));
  }
}
