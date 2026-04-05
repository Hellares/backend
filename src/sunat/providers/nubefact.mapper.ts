import {
  TIPO_COMPROBANTE_MAP,
  TIPO_IGV_MAP,
  MONEDA_MAP,
  SERIE_BETA,
  DOC_LENGTH,
  TIPO_DOC_SUNAT,
  IGV_DEFAULT,
  NubefactComprobanteRequest,
  NubefactItemRequest,
  NubefactAnulacionRequest,
  NubefactConsultaRequest,
  NubefactComprobanteResponse,
} from './nubefact.types';

// ── Interfaces de datos de entrada ──

interface ComprobanteData {
  id: string;
  tipoComprobante: string;
  serie: string;
  correlativo: string;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  nombreCliente: string;
  direccionCliente: string | null;
  emailCliente: string | null;
  fechaEmision: Date;
  fechaVencimiento: Date | null;
  moneda: string;
  tipoCambio: any;
  gravada: any;
  exonerada: any;
  inafecta: any;
  igv: any;
  icbper: any;
  total: any;
  totalIgv: any;
  comprobanteOrigenId?: string | null;
  tipoNotaCredito?: number | null;
  tipoNotaDebito?: number | null;
  motivoNota?: string | null;
  detalles: DetalleData[];
  venta?: {
    descuento?: any;
    esCredito?: boolean;
    cuotas?: Array<{ numero: number; monto: any; fechaVencimiento: Date }>;
  } | null;
}

interface DetalleData {
  descripcion: string;
  cantidad: any;
  valorUnitario: any;
  precioUnitario: any;
  tipoAfectacion: string;
  porcentajeIGV: any;
  igv: any;
  icbper: any;
  subtotal: any;
  total: any;
  descuentoItem: any;
  unidadMedida: string;
  producto?: { codigoEmpresa?: string } | null;
  servicio?: { codigoEmpresa?: string } | null;
}

interface ConfigData {
  porcentajeIGV: any;
  entorno: string;
}

interface ComprobanteOrigenData {
  tipoComprobante: string;
  serie: string;
  correlativo: string;
}

// ── Mapper ──

export class NubefactMapper {

  // ── Método principal ──

  static toNubefactRequest(
    comprobante: ComprobanteData,
    config: ConfigData,
    comprobanteOrigen?: ComprobanteOrigenData | null,
  ): NubefactComprobanteRequest {
    const tipo = comprobante.tipoComprobante;
    const esBeta = config.entorno === 'BETA';
    const serie = this.resolverSerie(tipo, comprobante.serie, esBeta, comprobanteOrigen);
    const porcentajeIGV = this.resolverIGV(comprobante.detalles, config);

    const { items, icbperTotal } = this.buildItems(comprobante, esBeta);
    const totales = this.buildTotales(comprobante, icbperTotal);
    const notaData = this.buildNotaData(tipo, comprobante, comprobanteOrigen, esBeta);
    const creditoData = this.buildCreditoData(comprobante);
    const descuentoData = this.buildDescuentoData(comprobante);

    return {
      operacion: 'generar_comprobante',
      tipo_de_comprobante: TIPO_COMPROBANTE_MAP[tipo] || 1,
      serie,
      numero: parseInt(comprobante.correlativo, 10),
      sunat_transaction: 1,
      cliente_tipo_de_documento: this.detectarTipoDocumento(comprobante.tipoDocumento, comprobante.numeroDocumento),
      cliente_numero_de_documento: comprobante.numeroDocumento || '00000000',
      cliente_denominacion: comprobante.nombreCliente || 'CLIENTE VARIOS',
      cliente_direccion: comprobante.direccionCliente || '-',
      cliente_email: comprobante.emailCliente || '',
      cliente_email_1: '',
      cliente_email_2: '',
      fecha_de_emision: this.formatFecha(comprobante.fechaEmision),
      fecha_de_vencimiento: comprobante.fechaVencimiento
        ? this.formatFecha(comprobante.fechaVencimiento)
        : '',
      moneda: MONEDA_MAP[comprobante.moneda] || 1,
      tipo_de_cambio: comprobante.tipoCambio ? String(Number(comprobante.tipoCambio)) : '',
      porcentaje_de_igv: porcentajeIGV,
      ...descuentoData,
      total_anticipo: '',
      total_gravada: totales.gravada,
      total_inafecta: totales.inafecta,
      total_exonerada: totales.exonerada,
      total_igv: totales.igv,
      total_gratuita: '',
      total_otros_cargos: '',
      total_impuestos_bolsas: totales.icbper,
      total: totales.total,
      percepcion_tipo: '',
      percepcion_base_imponible: '',
      total_percepcion: '',
      total_incluido_percepcion: '',
      retencion_tipo: '',
      retencion_base_imponible: '',
      total_retencion: '',
      detraccion: false,
      observaciones: comprobante.motivoNota || '',
      ...notaData,
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: false,
      codigo_unico: comprobante.id,
      ...creditoData,
      medio_de_pago: '',
      placa_vehiculo: '',
      orden_compra_servicio: '',
      formato_de_pdf: '',
      items,
      guias: [],
      ...( creditoData.venta_al_credito ? {} : { venta_al_credito: [] as any[] }),
    };
  }

  // ── Sub-métodos del request ──

  /** Construye items Nubefact con ICBPER distribuido */
  private static buildItems(comprobante: ComprobanteData, esBeta: boolean) {
    const icbperHeader = Number(comprobante.icbper || 0);

    // ICBPER por item: usar campo del detalle, o distribuir desde header (datos pre-migración)
    const icbperPorItem: number[] = comprobante.detalles.map(d => Number(d.icbper || 0));
    const sumaIcbperItems = icbperPorItem.reduce((a, b) => a + b, 0);

    if (icbperHeader > 0 && sumaIcbperItems === 0) {
      const idxInafecto = comprobante.detalles.findIndex(d => d.tipoAfectacion === '30');
      if (idxInafecto >= 0) icbperPorItem[idxInafecto] = icbperHeader;
    }

    const items: NubefactItemRequest[] = comprobante.detalles.map((d, idx) => {
      const cantidad = Number(d.cantidad);
      const subtotalItem = Number(d.subtotal);
      const igvItem = Number(d.igv);
      const itemIcbper = this.round2(icbperPorItem[idx] || 0);
      const descuento = Number(d.descuentoItem || 0);
      const tipoIgv = TIPO_IGV_MAP[d.tipoAfectacion] || 1;

      const valorUnit = cantidad > 0 ? subtotalItem / cantidad : 0;
      const igvPorcentaje = Number(d.porcentajeIGV || IGV_DEFAULT);
      const precioUnit = tipoIgv === 1 ? valorUnit * (1 + igvPorcentaje / 100) : valorUnit;

      return {
        unidad_de_medida: d.unidadMedida || 'NIU',
        codigo: d.producto?.codigoEmpresa || d.servicio?.codigoEmpresa || '',
        descripcion: d.descripcion,
        cantidad,
        valor_unitario: this.round2(valorUnit),
        precio_unitario: this.round2(precioUnit),
        descuento: descuento > 0 ? String(this.round2(descuento)) : '',
        subtotal: this.round2(subtotalItem),
        tipo_de_igv: tipoIgv,
        igv: this.round2(igvItem),
        total: this.round2(subtotalItem + igvItem),
        anticipo_regularizacion: false,
        anticipo_documento_serie: '',
        anticipo_documento_numero: '',
        ...(itemIcbper > 0 ? { impuesto_bolsas: itemIcbper } : {}),
      };
    });

    const icbperTotal = icbperPorItem.reduce((a, b) => a + b, 0);
    return { items, icbperTotal };
  }

  /** Calcula totales del comprobante para Nubefact */
  private static buildTotales(comprobante: ComprobanteData, icbperTotal: number) {
    const gravada = Number(comprobante.gravada || 0);
    const exonerada = Number(comprobante.exonerada || 0);
    const inafecta = Number(comprobante.inafecta || 0);
    const igv = Number(comprobante.igv || 0);
    const total = Number(comprobante.total || 0);

    return {
      gravada: this.round2(gravada),
      inafecta: inafecta > 0 ? this.round2(inafecta) : '' as number | string,
      exonerada: exonerada > 0 ? this.round2(exonerada) : '' as number | string,
      igv: this.round2(igv),
      icbper: icbperTotal > 0 ? this.round2(icbperTotal) : '' as number | string,
      total: this.round2(total),
    };
  }

  /** Datos de nota crédito/débito (referencia a doc origen) */
  private static buildNotaData(
    tipo: string,
    comprobante: ComprobanteData,
    comprobanteOrigen?: ComprobanteOrigenData | null,
    esBeta = false,
  ) {
    if (!comprobanteOrigen || (tipo !== 'NOTA_CREDITO' && tipo !== 'NOTA_DEBITO')) {
      return {
        documento_que_se_modifica_tipo: '' as number | string,
        documento_que_se_modifica_serie: '',
        documento_que_se_modifica_numero: '' as number | string,
        tipo_de_nota_de_credito: '' as number | string,
        tipo_de_nota_de_debito: '' as number | string,
      };
    }

    return {
      documento_que_se_modifica_tipo: TIPO_COMPROBANTE_MAP[comprobanteOrigen.tipoComprobante] || 1,
      documento_que_se_modifica_serie: esBeta
        ? this.serieBeta(comprobanteOrigen.tipoComprobante)
        : comprobanteOrigen.serie,
      documento_que_se_modifica_numero: parseInt(comprobanteOrigen.correlativo, 10),
      tipo_de_nota_de_credito: (tipo === 'NOTA_CREDITO' && comprobante.tipoNotaCredito) ? comprobante.tipoNotaCredito : '' as number | string,
      tipo_de_nota_de_debito: (tipo === 'NOTA_DEBITO' && comprobante.tipoNotaDebito) ? comprobante.tipoNotaDebito : '' as number | string,
    };
  }

  /** Datos de venta a crédito (cuotas) */
  private static buildCreditoData(comprobante: ComprobanteData) {
    const venta = comprobante.venta;
    if (!venta?.esCredito || !venta.cuotas?.length) {
      return { condiciones_de_pago: 'Contado', venta_al_credito: [] as any[] };
    }

    return {
      condiciones_de_pago: 'Credito',
      venta_al_credito: venta.cuotas.map((c) => ({
        cuota: c.numero,
        fecha_de_pago: this.formatFecha(c.fechaVencimiento),
        importe: this.round2(Number(c.monto)),
      })),
    };
  }

  /** Datos de descuento global */
  private static buildDescuentoData(comprobante: ComprobanteData) {
    const descuento = Number(comprobante.venta?.descuento || 0);
    if (descuento <= 0) return { descuento_global: '', total_descuento: '' };
    const val = String(this.round2(descuento));
    return { descuento_global: val, total_descuento: val };
  }

  // ── Otros mappers ──

  static fromNubefactResponse(response: NubefactComprobanteResponse) {
    return {
      sunatHash: response.codigo_hash || null,
      sunatXmlUrl: response.enlace_del_xml || null,
      sunatPdfUrl: response.enlace_del_pdf || null,
      sunatCdrUrl: response.enlace_del_cdr || null,
      cadenaQR: response.cadena_para_codigo_qr || null,
      enlaceNubefact: response.enlace || null,
      cdrResponse: response as any,
      nubefactEnviado: true,
    };
  }

  static toAnulacionRequest(
    comprobante: { tipoComprobante: string; serie: string; correlativo: string; id: string },
    motivo: string,
    entorno: string,
  ): NubefactAnulacionRequest {
    const serie = entorno === 'BETA' ? this.serieBeta(comprobante.tipoComprobante) : comprobante.serie;
    return {
      operacion: 'generar_anulacion',
      tipo_de_comprobante: TIPO_COMPROBANTE_MAP[comprobante.tipoComprobante] || 1,
      serie,
      numero: parseInt(comprobante.correlativo, 10),
      motivo,
      codigo_unico: comprobante.id,
    };
  }

  static toConsultaRequest(
    comprobante: { tipoComprobante: string; serie: string; correlativo: string },
    operacion: 'consultar_comprobante' | 'consultar_anulacion',
    entorno: string,
  ): NubefactConsultaRequest {
    const serie = entorno === 'BETA' ? this.serieBeta(comprobante.tipoComprobante) : comprobante.serie;
    return {
      operacion,
      tipo_de_comprobante: TIPO_COMPROBANTE_MAP[comprobante.tipoComprobante] || 1,
      serie,
      numero: parseInt(comprobante.correlativo, 10),
    };
  }

  // ── Helpers ──

  /** Detecta tipo documento SUNAT por longitud: RUC (11), DNI (8) */
  static detectarTipoDocumento(tipoDocumento: string | null, numeroDocumento: string | null): string {
    const doc = (numeroDocumento || '').trim();
    if (doc.length === DOC_LENGTH.RUC) return TIPO_DOC_SUNAT.RUC;
    if (doc.length === DOC_LENGTH.DNI) return TIPO_DOC_SUNAT.DNI;
    if (doc.length === 0) return TIPO_DOC_SUNAT.VARIOS;
    if (tipoDocumento && tipoDocumento !== '-') return tipoDocumento;
    return TIPO_DOC_SUNAT.VARIOS;
  }

  /** Resuelve serie para el payload: BETA override o serie real */
  private static resolverSerie(
    tipo: string,
    serieReal: string,
    esBeta: boolean,
    comprobanteOrigen?: ComprobanteOrigenData | null,
  ): string {
    if (!esBeta) return serieReal;
    if (tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO') {
      const esOrigenFactura = comprobanteOrigen
        ? comprobanteOrigen.tipoComprobante === 'FACTURA'
        : serieReal.startsWith('F');
      return esOrigenFactura ? SERIE_BETA.FACTURA : SERIE_BETA.BOLETA;
    }
    return tipo === 'FACTURA' ? SERIE_BETA.FACTURA : SERIE_BETA.BOLETA;
  }

  /** Determina IGV% real desde items gravados o config */
  private static resolverIGV(detalles: DetalleData[], config: ConfigData): number {
    const itemGravado = detalles.find(d => d.tipoAfectacion === '10');
    return itemGravado ? Number(itemGravado.porcentajeIGV || IGV_DEFAULT) : Number(config.porcentajeIGV || IGV_DEFAULT);
  }

  /** Serie BETA según tipo de comprobante (F→FFF1, B→BBB1) */
  private static serieBeta(tipoComprobante: string): string {
    return tipoComprobante === 'FACTURA' || tipoComprobante === 'NOTA_CREDITO'
      ? SERIE_BETA.FACTURA
      : SERIE_BETA.BOLETA;
  }

  /** Formatea fecha a DD-MM-YYYY con timezone Perú */
  static formatFecha(date: Date): string {
    const d = new Date(date);
    const parts = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value ?? '01';
    const month = parts.find(p => p.type === 'month')?.value ?? '01';
    const year = parts.find(p => p.type === 'year')?.value ?? '2026';
    return `${day}-${month}-${year}`;
  }

  private static round2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
