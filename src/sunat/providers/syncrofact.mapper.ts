import {
  TIPO_DOC_SUNAT,
  DOC_LENGTH,
  IGV_DEFAULT,
  TIPO_DOC_AFECTADO,
  SyncrofactClient,
  SyncrofactItem,
  SyncrofactCuota,
  SyncrofactMedioPago,
  SyncrofactInvoiceRequest,
  SyncrofactNotaRequest,
  SyncrofactProveedorConfig,
  UMBRAL_BANCARIZACION,
  METODO_PAGO_MAP,
  MEDIOS_SIN_REFERENCIA,
  MEDIOS_REQUIEREN_BANCO,
} from './syncrofact.types';

// ── Interfaces de datos de entrada (mismo contrato del comprobante interno) ──

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
    metodoPago?: string | null;
    bancoPago?: string | null;
    referenciaPago?: string | null;
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
  proveedorConfig?: SyncrofactProveedorConfig | null;
}

interface ComprobanteOrigenData {
  tipoComprobante: string;
  serie: string;
  correlativo: string;
}

// ── Mapper ──

export class SyncrofactMapper {
  /** Construye el payload para POST /v1/invoices o /v1/boletas */
  static toInvoiceRequest(
    comprobante: ComprobanteData,
    config: ConfigData,
  ): SyncrofactInvoiceRequest {
    const proveedorConfig = this.requireProveedorConfig(config);
    const esCredito = comprobante.venta?.esCredito === true;
    const esBoleta = comprobante.tipoComprobante === 'BOLETA';

    const body: SyncrofactInvoiceRequest = {
      company_id: proveedorConfig.companyId,
      branch_id: proveedorConfig.branchId,
      serie: comprobante.serie,
      correlativo: parseInt(comprobante.correlativo, 10),
      referencia_interna: comprobante.id,
      fecha_emision: this.formatFecha(comprobante.fechaEmision),
      moneda: comprobante.moneda || 'PEN',
      forma_pago_tipo: esCredito ? 'Credito' : 'Contado',
      client: this.buildClient(comprobante),
      detalles: this.buildItems(comprobante),
    };

    if (comprobante.fechaVencimiento) {
      body.fecha_vencimiento = this.formatFecha(comprobante.fechaVencimiento);
    }

    if (comprobante.tipoCambio && Number(comprobante.tipoCambio) > 0) {
      body.tipo_cambio = Number(comprobante.tipoCambio);
    }

    if (esCredito && comprobante.venta?.cuotas?.length) {
      body.forma_pago_cuotas = this.buildCuotas(comprobante);
    }

    // Bancarización Ley 28194: agregar medios_pago cuando aplique
    const mediosPago = this.buildMediosPago(comprobante);
    if (mediosPago) {
      body.medios_pago = mediosPago;
    }

    if (esBoleta) {
      body.metodo_envio = 'individual';
    }

    return body;
  }

  /** Construye el payload para POST /v1/credit-notes o /v1/debit-notes */
  static toNotaRequest(
    comprobante: ComprobanteData,
    config: ConfigData,
    comprobanteOrigen: ComprobanteOrigenData,
  ): SyncrofactNotaRequest {
    const proveedorConfig = this.requireProveedorConfig(config);
    const esNotaCredito = comprobante.tipoComprobante === 'NOTA_CREDITO';
    const codMotivo = this.resolverCodigoMotivo(comprobante, esNotaCredito);

    const numDocAfectado = `${comprobanteOrigen.serie}-${comprobanteOrigen.correlativo.padStart(8, '0')}`;

    return {
      company_id: proveedorConfig.companyId,
      branch_id: proveedorConfig.branchId,
      serie: comprobante.serie,
      correlativo: parseInt(comprobante.correlativo, 10),
      referencia_interna: comprobante.id,
      fecha_emision: this.formatFecha(comprobante.fechaEmision),
      moneda: comprobante.moneda || 'PEN',
      tipo_doc_afectado: TIPO_DOC_AFECTADO[comprobanteOrigen.tipoComprobante] || '01',
      num_doc_afectado: numDocAfectado,
      cod_motivo: codMotivo,
      des_motivo: comprobante.motivoNota || (esNotaCredito ? 'Anulacion de la operacion' : 'Intereses por mora'),
      client: this.buildClient(comprobante),
      detalles: this.buildItems(comprobante),
    };
  }

  // ── Sub-builders ──

  private static buildClient(comprobante: ComprobanteData): SyncrofactClient {
    const client: SyncrofactClient = {
      tipo_documento: this.detectarTipoDocumento(comprobante.tipoDocumento, comprobante.numeroDocumento),
      numero_documento: comprobante.numeroDocumento || '00000000',
      razon_social: comprobante.nombreCliente || 'CLIENTE VARIOS',
    };

    if (comprobante.direccionCliente) client.direccion = comprobante.direccionCliente;
    if (comprobante.emailCliente) client.email = comprobante.emailCliente;

    return client;
  }

  private static buildItems(comprobante: ComprobanteData): SyncrofactItem[] {
    return comprobante.detalles.map((d) => {
      const cantidad = Number(d.cantidad);
      const valorUnitario = Number(d.valorUnitario);
      const precioUnitario = Number(d.precioUnitario);
      const porcentajeIGV = Number(d.porcentajeIGV || IGV_DEFAULT);
      const tipAfeIgv = d.tipoAfectacion || '10';
      const itemIcbper = Number(d.icbper || 0);

      // Doc Syncrofact: "Usar `mto_valor_unitario` (sin IGV) O `mto_precio_unitario`
      // (con IGV), no ambos". Mandar solo uno evita desajuste de centavos al
      // recalcular (ej. 1016.95 × 2 × 1.18 = 2400.0256 vs total real 2400).
      //
      // Regla: si el item es gravado (IGV > 0) preferimos `mto_precio_unitario`
      // para que `qty × precio` sea exacto contra el total de la venta. Syncrofact
      // calcula el valor sin IGV internamente con precisión completa.
      // Para exonerados/inafectos `precio == valor`, mandamos `mto_valor_unitario`.
      const esGravado = tipAfeIgv === '10' && porcentajeIGV > 0;
      const montoUnitario = esGravado ? precioUnitario : valorUnitario;

      const item: SyncrofactItem = {
        codigo: d.producto?.codigoEmpresa || d.servicio?.codigoEmpresa || 'SIN-CODIGO',
        descripcion: d.descripcion,
        unidad: d.unidadMedida || 'NIU',
        cantidad,
        tip_afe_igv: tipAfeIgv,
        porcentaje_igv: esGravado ? porcentajeIGV : 0,
      };

      if (esGravado) {
        item.mto_precio_unitario = this.round2(montoUnitario);
      } else {
        item.mto_valor_unitario = this.round2(montoUnitario);
      }

      if (itemIcbper > 0) item.icbper = this.round2(itemIcbper);

      return item;
    });
  }

  private static buildCuotas(comprobante: ComprobanteData): SyncrofactCuota[] {
    const moneda = comprobante.moneda || 'PEN';
    return (comprobante.venta!.cuotas || []).map((c) => ({
      moneda,
      monto: this.round2(Number(c.monto)),
      fecha_pago: this.formatFecha(c.fechaVencimiento),
    }));
  }

  /**
   * Construye `medios_pago` según Ley 28194 (bancarización).
   *
   * Retorna null si:
   *  - total < umbral (2000 PEN / 500 USD)
   *  - es venta a crédito (se usa `forma_pago_cuotas` en su lugar)
   *  - no hay `venta.metodoPago` (caso legacy / cotizaciones sin venta vinculada)
   *
   * Lanza error explícito si falta un dato requerido por el catálogo del proveedor
   * (ej. referencia en YAPE o banco en TRANSFERENCIA). Así el service puede
   * abortar ANTES de pegarle a Syncrofact y devolver un 400 limpio al usuario.
   */
  private static buildMediosPago(comprobante: ComprobanteData): SyncrofactMedioPago[] | null {
    const venta = comprobante.venta;
    if (!venta || venta.esCredito) return null;

    const metodoInterno = venta.metodoPago;
    if (!metodoInterno) return null;

    const moneda = comprobante.moneda || 'PEN';
    const umbral = moneda === 'USD' ? UMBRAL_BANCARIZACION.USD : UMBRAL_BANCARIZACION.PEN;
    const total = Number(comprobante.total);
    if (!Number.isFinite(total) || total < umbral) return null;

    const tipoSyncrofact = METODO_PAGO_MAP[metodoInterno];
    if (!tipoSyncrofact) {
      throw new Error(
        `Método de pago "${metodoInterno}" no tiene mapeo para bancarización Syncrofact. ` +
        `Venta de ${moneda} ${total} requiere bancarización pero el método no está soportado.`,
      );
    }

    const medio: SyncrofactMedioPago = {
      tipo: tipoSyncrofact,
      monto: this.round2(total),
    };

    if (!MEDIOS_SIN_REFERENCIA.has(tipoSyncrofact)) {
      if (!venta.referenciaPago) {
        throw new Error(
          `Bancarización: la venta supera ${umbral} ${moneda} y requiere referencia/N° de operación ` +
          `para el método de pago ${metodoInterno}.`,
        );
      }
      medio.referencia = venta.referenciaPago;
      medio.fecha_operacion = this.formatFecha(comprobante.fechaEmision);
    }

    if (MEDIOS_REQUIEREN_BANCO.has(tipoSyncrofact)) {
      if (!venta.bancoPago) {
        throw new Error(
          `Bancarización: la venta supera ${umbral} ${moneda} y requiere banco (entidad financiera) ` +
          `para el método de pago ${metodoInterno}.`,
        );
      }
      medio.entidad_financiera = venta.bancoPago;
    }

    return [medio];
  }

  // ── Helpers ──

  /** Resuelve código de motivo SUNAT para nota (NC catálogo 09, ND catálogo 10) */
  private static resolverCodigoMotivo(comprobante: ComprobanteData, esNotaCredito: boolean): string {
    const tipo = esNotaCredito ? comprobante.tipoNotaCredito : comprobante.tipoNotaDebito;
    if (!tipo) return esNotaCredito ? '01' : '01';
    return String(tipo).padStart(2, '0');
  }

  /** Detecta tipo documento SUNAT por longitud: RUC (11), DNI (8) */
  static detectarTipoDocumento(tipoDocumento: string | null, numeroDocumento: string | null): string {
    const doc = (numeroDocumento || '').trim();
    if (doc.length === DOC_LENGTH.RUC) return TIPO_DOC_SUNAT.RUC;
    if (doc.length === DOC_LENGTH.DNI) return TIPO_DOC_SUNAT.DNI;
    if (doc.length === 0) return TIPO_DOC_SUNAT.OTROS;
    // Mapear códigos internos a los de Syncrofact si aplica
    if (tipoDocumento === '6' || tipoDocumento === 'RUC') return TIPO_DOC_SUNAT.RUC;
    if (tipoDocumento === '1' || tipoDocumento === 'DNI') return TIPO_DOC_SUNAT.DNI;
    if (tipoDocumento === '4' || tipoDocumento === 'CE') return TIPO_DOC_SUNAT.CE;
    return TIPO_DOC_SUNAT.OTROS;
  }

  /** Formatea fecha a YYYY-MM-DD con timezone Perú */
  static formatFecha(date: Date): string {
    const d = new Date(date);
    const parts = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
    return `${year}-${month}-${day}`;
  }

  private static round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private static requireProveedorConfig(config: ConfigData): SyncrofactProveedorConfig {
    const pc = config.proveedorConfig;
    if (!pc || typeof pc.companyId !== 'number' || typeof pc.branchId !== 'number') {
      throw new Error(
        'Syncrofact requiere proveedorConfig con companyId y branchId. Configúralo en ConfiguracionFacturacion o Sede.',
      );
    }
    return pc;
  }
}
