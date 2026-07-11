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
    /** Pago único legacy: si no hay `pagos[]` pero sí `metodoPago`, se sintetiza un pago virtual sin banco/referencia. */
    metodoPago?: string | null;
    /** Pagos individuales — fuente principal para construir medios_pago en Fase 2. */
    pagos?: Array<{
      metodoPago: string;
      monto: any;
      referencia?: string | null;
      banco?: string | null;
    }>;
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
  producto?: { codigoEmpresa?: string; codigoProductoSunat?: string | null } | null;
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
    // Una venta marcada "a crédito" pero SIN cuotas pendientes (pagada por
    // adelantado en su totalidad → 0 cuotas) es CONTADO para SUNAT. forma_pago
    // Credito exige `forma_pago_cuotas` que sumen el saldo; sin cuotas,
    // Syncrofact/SUNAT rechaza ("Debe especificar las cuotas de pago...").
    const esCredito = this.esCreditoConCuotas(comprobante.venta);
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

    if (esCredito) {
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

      // Código de producto SUNAT (catálogos 25/25.1/25.2/25.3): passthrough
      // opcional. Solo cuando el producto lo tiene seteado — sin él, el XML
      // sale sin cac:CommodityClassification y SUNAT no valida nada.
      const codigoSunat = d.producto?.codigoProductoSunat;
      if (codigoSunat && /^\d{8}$/.test(codigoSunat)) {
        item.codigo_producto_sunat = codigoSunat;
      }

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
   * Construye `medios_pago` según Ley 28194 (bancarización) en modo multi-medio.
   *
   * Retorna null si:
   *  - es venta a crédito (se usa `forma_pago_cuotas` en su lugar)
   *  - no hay pagos vinculados (caso legacy sin venta o venta sin pagos)
   *  - el total < umbral Y todos los pagos son EFECTIVO (no es necesario reportar)
   *
   * Itera `venta.pagos[]` y arma un array con todos los medios. Si la venta
   * no trae `pagos[]` (legacy sin Fase 2) sintetiza un pago virtual desde
   * `venta.metodoPago` sin banco/referencia — la validación en el service
   * abortará si el método requiere bancarización.
   *
   * Lanza error si falta un dato requerido por el catálogo del proveedor
   * (referencia en YAPE / banco en TRANSFERENCIA). El service aborta ANTES de
   * pegarle a Syncrofact.
   */
  /**
   * Una venta es "a crédito" para SUNAT solo si tiene cuotas pendientes. Un
   * crédito pagado por adelantado en su totalidad (0 cuotas) es CONTADO: no se
   * manda `forma_pago_cuotas` (rechazo) y SÍ corresponde reportar `medios_pago`.
   */
  private static esCreditoConCuotas(venta: ComprobanteData['venta']): boolean {
    return venta?.esCredito === true && (venta?.cuotas?.length ?? 0) > 0;
  }

  private static buildMediosPago(comprobante: ComprobanteData): SyncrofactMedioPago[] | null {
    const venta = comprobante.venta;
    if (!venta || this.esCreditoConCuotas(venta)) return null;

    const moneda = comprobante.moneda || 'PEN';
    const umbral = moneda === 'USD' ? UMBRAL_BANCARIZACION.USD : UMBRAL_BANCARIZACION.PEN;
    const total = Number(comprobante.total);
    if (!Number.isFinite(total)) return null;

    // Ley 28194: solo es obligatorio reportar `medios_pago` cuando la venta
    // alcanza el umbral. Por debajo, Syncrofact acepta el comprobante sin el array,
    // así que omitimos la validación para no bloquear ventas pequeñas con YAPE/PLIN/etc.
    if (total < umbral) return null;

    // Fuente principal: pagos[]; fallback legacy: venta.metodoPago sin banco/referencia
    const pagosFuente = (venta.pagos && venta.pagos.length > 0)
      ? venta.pagos
      : (venta.metodoPago
          ? [{
              metodoPago: venta.metodoPago,
              monto: total,
              referencia: null,
              banco: null,
            }]
          : []);

    if (pagosFuente.length === 0) return null;

    const fechaOp = this.formatFecha(comprobante.fechaEmision);
    const medios: SyncrofactMedioPago[] = [];

    for (const p of pagosFuente) {
      const tipoSyncrofact = METODO_PAGO_MAP[p.metodoPago];
      if (!tipoSyncrofact) {
        throw new Error(
          `Método de pago "${p.metodoPago}" no tiene mapeo para bancarización Syncrofact.`,
        );
      }

      const medio: SyncrofactMedioPago = {
        tipo: tipoSyncrofact,
        monto: this.round2(Number(p.monto)),
      };

      if (!MEDIOS_SIN_REFERENCIA.has(tipoSyncrofact)) {
        if (!p.referencia) {
          throw new Error(
            `Bancarización: el pago de ${p.metodoPago} (${moneda} ${Number(p.monto).toFixed(2)}) ` +
            `requiere referencia/N° de operación.`,
          );
        }
        medio.referencia = p.referencia;
        medio.fecha_operacion = fechaOp;
      }

      if (MEDIOS_REQUIEREN_BANCO.has(tipoSyncrofact)) {
        if (!p.banco) {
          throw new Error(
            `Bancarización: el pago de ${p.metodoPago} (${moneda} ${Number(p.monto).toFixed(2)}) ` +
            `requiere banco (entidad financiera).`,
          );
        }
        medio.entidad_financiera = p.banco;
      }

      medios.push(medio);
    }

    return medios;
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
