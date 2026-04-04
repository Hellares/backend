import {
  TIPO_COMPROBANTE_MAP,
  TIPO_IGV_MAP,
  MONEDA_MAP,
  NubefactComprobanteRequest,
  NubefactItemRequest,
  NubefactAnulacionRequest,
  NubefactConsultaRequest,
  NubefactComprobanteResponse,
} from './nubefact.types';

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
}

interface DetalleData {
  descripcion: string;
  cantidad: any;
  valorUnitario: any;
  precioUnitario: any;
  tipoAfectacion: string;
  porcentajeIGV: any;
  igv: any;
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

export class NubefactMapper {
  static toNubefactRequest(
    comprobante: ComprobanteData,
    config: ConfigData,
    comprobanteOrigen?: ComprobanteOrigenData | null,
  ): NubefactComprobanteRequest {
    const tipo = comprobante.tipoComprobante;
    const tipoNubefact = TIPO_COMPROBANTE_MAP[tipo] || 1;

    // Determinar IGV real desde los items gravados (no el global de config)
    const itemGravado = comprobante.detalles.find(d => d.tipoAfectacion === '10');
    const porcentajeIGV = itemGravado ? Number(itemGravado.porcentajeIGV || 18) : Number(config.porcentajeIGV || 18);

    // Serie: en BETA override a FFF1/BBB1
    // Para notas: la serie depende del doc origen (B→BBB1, F→FFF1), no del tipo de nota
    let serie = comprobante.serie;
    if (config.entorno === 'BETA') {
      if (tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO') {
        // Determinar por doc origen o por prefijo de la serie actual
        const esOrigenFactura = comprobanteOrigen
          ? comprobanteOrigen.tipoComprobante === 'FACTURA'
          : serie.startsWith('F');
        serie = esOrigenFactura ? 'FFF1' : 'BBB1';
      } else if (tipo === 'FACTURA') {
        serie = 'FFF1';
      } else if (tipo === 'BOLETA') {
        serie = 'BBB1';
      }
    }

    const items: NubefactItemRequest[] = comprobante.detalles.map((d) => {
      const cantidad = Number(d.cantidad);
      const subtotalItem = Number(d.subtotal);
      const igvItem = Number(d.igv);
      const totalItem = Number(d.total);
      const descuento = Number(d.descuentoItem || 0);
      const tipoIgv = TIPO_IGV_MAP[d.tipoAfectacion] || 1;

      // Nubefact: valor_unitario = subtotal / cantidad (sin IGV)
      // Nubefact: precio_unitario = valor_unitario * (1 + IGV%) para gravado, = valor_unitario para exonerado/inafecto
      const valorUnit = cantidad > 0 ? subtotalItem / cantidad : 0;
      const igvPorcentaje = Number(d.porcentajeIGV || 18);
      const precioUnit = tipoIgv === 1 ? valorUnit * (1 + igvPorcentaje / 100) : valorUnit;

      return {
        unidad_de_medida: d.unidadMedida || 'NIU',
        codigo: d.producto?.codigoEmpresa || d.servicio?.codigoEmpresa || '',
        descripcion: d.descripcion,
        cantidad,
        valor_unitario: this.round2(valorUnit),
        precio_unitario: this.round2(precioUnit),
        descuento: descuento > 0 ? String(Math.round(descuento * 100) / 100) : '',
        subtotal: this.round2(subtotalItem),
        tipo_de_igv: tipoIgv,
        igv: this.round2(igvItem),
        total: this.round2(subtotalItem + igvItem),
        anticipo_regularizacion: false,
        anticipo_documento_serie: '',
        anticipo_documento_numero: '',
      };
    });

    const gravada = Number(comprobante.gravada || 0);
    const exonerada = Number(comprobante.exonerada || 0);
    const inafecta = Number(comprobante.inafecta || 0);
    const igv = Number(comprobante.igv || 0);
    const icbper = Number(comprobante.icbper || 0);
    const total = Number(comprobante.total || 0);

    // Notas de crédito/débito
    let docModificaTipo: number | string = '';
    let docModificaSerie = '';
    let docModificaNumero: number | string = '';
    let tipoNotaCredito: number | string = '';
    let tipoNotaDebito: number | string = '';

    if (comprobanteOrigen && (tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO')) {
      docModificaTipo = TIPO_COMPROBANTE_MAP[comprobanteOrigen.tipoComprobante] || 1;
      docModificaSerie = config.entorno === 'BETA'
        ? (comprobanteOrigen.tipoComprobante === 'FACTURA' ? 'FFF1' : 'BBB1')
        : comprobanteOrigen.serie;
      docModificaNumero = parseInt(comprobanteOrigen.correlativo, 10);

      if (tipo === 'NOTA_CREDITO' && comprobante.tipoNotaCredito) {
        tipoNotaCredito = comprobante.tipoNotaCredito;
      }
      if (tipo === 'NOTA_DEBITO' && comprobante.tipoNotaDebito) {
        tipoNotaDebito = comprobante.tipoNotaDebito;
      }
    }

    return {
      operacion: 'generar_comprobante',
      tipo_de_comprobante: tipoNubefact,
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
      descuento_global: '',
      total_descuento: '',
      total_anticipo: '',
      total_gravada: this.round2(gravada),
      total_inafecta: inafecta > 0 ? this.round2(inafecta) : '',
      total_exonerada: exonerada > 0 ? this.round2(exonerada) : '',
      total_igv: this.round2(igv),
      total_gratuita: '',
      total_otros_cargos: '',
      // ICBPER: por ahora no enviar (DetalleComprobante no tiene desglose por línea)
      // Restar ICBPER del total para que cuadre: total Nubefact = gravada + exonerada + inafecta + igv
      total_impuestos_bolsas: '',
      total: this.round2(total - icbper),
      percepcion_tipo: '',
      percepcion_base_imponible: '',
      total_percepcion: '',
      total_incluido_percepcion: '',
      retencion_tipo: '',
      retencion_base_imponible: '',
      total_retencion: '',
      detraccion: false,
      observaciones: comprobante.motivoNota || '',
      documento_que_se_modifica_tipo: docModificaTipo,
      documento_que_se_modifica_serie: docModificaSerie,
      documento_que_se_modifica_numero: docModificaNumero,
      tipo_de_nota_de_credito: tipoNotaCredito,
      tipo_de_nota_de_debito: tipoNotaDebito,
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: false,
      codigo_unico: comprobante.id,
      condiciones_de_pago: '',
      medio_de_pago: '',
      placa_vehiculo: '',
      orden_compra_servicio: '',
      formato_de_pdf: '',
      items,
      guias: [],
      venta_al_credito: [],
    };
  }

  /** Detecta tipo documento SUNAT basado en la longitud del número.
   *  Siempre valida coherencia entre tipo y longitud del documento. */
  static detectarTipoDocumento(tipoDocumento: string | null, numeroDocumento: string | null): string {
    const doc = (numeroDocumento || '').trim();

    // Detección por longitud del documento (fuente de verdad)
    if (doc.length === 11) return '6'; // RUC
    if (doc.length === 8) return '1';  // DNI
    if (doc.length === 0) return '-';  // Sin documento

    // Si tiene longitud no estándar, usar tipo explícito o genérico
    if (tipoDocumento && tipoDocumento !== '-') return tipoDocumento;
    return '-';
  }

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
    let serie = comprobante.serie;
    if (entorno === 'BETA') {
      serie = comprobante.tipoComprobante === 'FACTURA' || comprobante.tipoComprobante === 'NOTA_CREDITO'
        ? 'FFF1' : 'BBB1';
    }
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
    let serie = comprobante.serie;
    if (entorno === 'BETA') {
      serie = comprobante.tipoComprobante === 'FACTURA' || comprobante.tipoComprobante === 'NOTA_CREDITO'
        ? 'FFF1' : 'BBB1';
    }
    return {
      operacion,
      tipo_de_comprobante: TIPO_COMPROBANTE_MAP[comprobante.tipoComprobante] || 1,
      serie,
      numero: parseInt(comprobante.correlativo, 10),
    };
  }

  static formatFecha(date: Date): string {
    const d = new Date(date);
    // Usar timezone Perú para garantizar fecha correcta ante SUNAT
    const parts = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(d);
    const day = parts.find(p => p.type === 'day')!.value;
    const month = parts.find(p => p.type === 'month')!.value;
    const year = parts.find(p => p.type === 'year')!.value;
    return `${day}-${month}-${year}`;
  }

  private static round2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
