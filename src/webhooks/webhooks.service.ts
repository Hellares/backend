import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { EstadoVenta, MetodoPagoVenta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { VentaService } from '../venta/venta.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { PedidoMarketplaceEmpresaService } from '../pedido-marketplace/pedido-marketplace-empresa.service';
import { CotizacionService } from '../cotizacion/cotizacion.service';
import { SorteosService } from '../sorteos/sorteos.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { nombresCoinciden } from '../sorteos/nombre-match.util';

/**
 * Payload estándar de Syncrofact (documentacion/webhooks.md).
 * Campos conocidos:
 *   event: "invoice.accepted" | "invoice.rejected" | "invoice.voided" |
 *          "boleta.accepted"  | "boleta.rejected"  |
 *          "credit_note.accepted" | "credit_note.rejected" |
 *          "debit_note.accepted"  | "debit_note.rejected"  |
 *          "dispatch_guide.accepted" | "dispatch_guide.rejected"
 *   timestamp: ISO-8601
 *   data: {
 *     document_id: number          // ID interno de Syncrofact
 *     document_type: string
 *     numero: string               // "F002-00000002"
 *     company_id: number           // ID de la empresa en Syncrofact
 *     estado_sunat: string         // "ACEPTADO" | "RECHAZADO" | ...
 *     referencia_interna?: string  // nuestro ComprobanteElectronico.id (si fue enviado)
 *     // ...otros campos como cliente, totales, fechas, sunat_response
 *   }
 */
interface SyncrofactWebhookPayload {
  event: string;
  timestamp?: string;
  data: {
    document_id?: number;
    numero?: string;
    company_id?: number;
    estado_sunat?: string;
    referencia_interna?: string;
    result?: any;
    /** Código SUNAT del rechazo (4 dígitos) — solo en eventos `*.rejected`. */
    error_code?: string | null;
    /** Mensaje SUNAT del rechazo (ya sin el prefijo "codigo - "). */
    error_message?: string | null;
    [k: string]: any;
  };
}

const EVENTOS_ACEPTACION = new Set([
  'invoice.accepted',
  'boleta.accepted',
  'credit_note.accepted',
  'debit_note.accepted',
  'dispatch_guide.accepted',
]);

const EVENTOS_RECHAZO = new Set([
  'invoice.rejected',
  'boleta.rejected',
  'credit_note.rejected',
  'debit_note.rejected',
  'dispatch_guide.rejected',
]);

const EVENTOS_ANULACION = new Set([
  'invoice.voided',
]);

/** Eventos del flujo Comunicación de Baja (RA) — entidad propia ComunicacionBaja. */
const EVENTOS_BAJA = new Set([
  'voided_document.sent',
  'voided_document.processed',
  'voided_document.accepted',
  'voided_document.rejected',
]);

/**
 * Eventos del flujo Resumen Diario (RC) — entidad propia ResumenDiario.
 * Nota: NO existe `daily_summary.rejected` separado. `daily_summary.processed`
 * se dispara para cualquier estado terminal y hay que mirar `data.estado_sunat`.
 */
const EVENTOS_RC = new Set([
  'daily_summary.created',
  'daily_summary.sent',
  'daily_summary.processed',
]);

@Injectable()
export class WebhooksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly integracionYape: IntegracionYapeService,
    private readonly ventaService: VentaService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly pedidoMarketplaceEmpresa: PedidoMarketplaceEmpresaService,
    private readonly cotizacionService: CotizacionService,
    private readonly sorteosService: SorteosService,
    private readonly whatsapp: WhatsappService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('WebhooksService');
  }

  /**
   * Procesa una confirmación de pago de api-yape (evento payment.confirmed):
   * verifica la firma, ubica la venta por charge.reference y la marca pagada
   * reutilizando VentaService.procesarPago con el monto LIMPIO de la venta
   * (no el payAmount con céntimos). Idempotente. Avisa a la app por FCM.
   */
  async procesarPagoYape(rawBody: Buffer, firma: string) {
    const verif = await this.integracionYape.verificarWebhook(rawBody, firma);
    if (!verif) return { ok: true, accion: 'cuenta-no-mapeada' };
    const { empresaId, payload } = verif;

    // Pago RECIBIDO sin charge (yape "suelto"): primero se intenta contra las
    // participaciones de SORTEOS (nombre + monto exacto + única); si no
    // validó, contra las VENTAS del agente IA (mismo criterio: el cliente
    // paga el precio REDONDO y se matchea por su nombre — sin céntimos).
    if (payload?.event === 'payment.received') {
      const res = await this.sorteosService.autoValidarPorPagoYape(
        empresaId,
        payload?.payment ?? {},
      );
      if (res.accion === 'participante-auto-validado') {
        this.logger.log(`Webhook payment.received → ${res.accion}`);
        return { ok: true, ...res };
      }
      const resVenta = await this.autoValidarVentaPorPagoYape(
        empresaId,
        payload?.payment ?? {},
      );
      this.logger.log(
        `Webhook payment.received → sorteo:${res.accion} venta:${resVenta.accion}`,
      );
      return { ok: true, ...resVenta };
    }

    if (payload?.event !== 'payment.confirmed') {
      return { ok: true, accion: 'evento-ignorado' };
    }
    const reference: string | undefined = payload?.charge?.reference;
    if (!reference) return { ok: true, accion: 'sin-referencia' };

    // Pedidos del MARKETPLACE usan reference con prefijo `pedido:` → el pago
    // valida el pedido automáticamente (PAGO_VALIDADO sin foto ni validación
    // manual). La Venta interna se crea recién al ENVIAR, no aquí.
    if (reference.startsWith('pedido:')) {
      const metodoPedido =
        payload?.payment?.provider === 'plin' ? ('PLIN' as const) : ('YAPE' as const);
      const res = await this.pedidoMarketplaceEmpresa.confirmarPagoYapeAutomatico(
        empresaId,
        reference.slice('pedido:'.length),
        {
          metodo: metodoPedido,
          referencia:
            payload?.payment?.operationCode || payload?.payment?.id || undefined,
        },
      );
      return { ok: true, ...res };
    }

    // Adelantos de SEPARACIÓN (cotización del marketplace) usan prefijo
    // `cotizacion:` → registra el adelanto, reserva stock y aprueba la
    // cotización automáticamente.
    if (reference.startsWith('cotizacion:')) {
      const metodoCot =
        payload?.payment?.provider === 'plin' ? ('PLIN' as const) : ('YAPE' as const);
      const res = await this.cotizacionService.confirmarAdelantoYapeAutomatico(
        empresaId,
        reference.slice('cotizacion:'.length),
        {
          monto: Number(payload?.charge?.baseAmount ?? 0),
          metodo: metodoCot,
          referencia:
            payload?.payment?.operationCode || payload?.payment?.id || undefined,
        },
      );
      return { ok: true, ...res };
    }

    const ventaId: string = reference;

    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: { pagos: true },
    });
    if (!venta) return { ok: true, accion: 'venta-no-encontrada' };
    if (venta.estado === EstadoVenta.PAGADA_COMPLETA) {
      return { ok: true, accion: 'ya-pagada' };
    }
    // Webhook tardío sobre una venta que el TTL ya anuló (cliente no pagó a
    // tiempo, se liberó el stock). No reabrir ni "cobrar" una venta anulada.
    if (venta.estado === EstadoVenta.ANULADA) {
      this.logger.warn(
        `Webhook Yape para venta ${ventaId} ya ANULADA (expirada por TTL) — ignorado`,
      );
      return { ok: true, accion: 'venta-anulada' };
    }

    const totalPagado = venta.pagos.reduce(
      (s: number, p: { monto: any }) => s + Number(p.monto),
      0,
    );
    const pendiente = Number(venta.total) - totalPagado;
    if (pendiente <= 0) return { ok: true, accion: 'sin-saldo' };

    const metodo =
      payload?.payment?.provider === 'plin'
        ? MetodoPagoVenta.PLIN
        : MetodoPagoVenta.YAPE;

    // PAGOS DIVIDIDOS: registramos el monto del CHARGE confirmado (su
    // `baseAmount`, el tramo que pidió la caja), NO el pendiente completo. Así
    // una venta cobrada en varios Yape/Plin (ej. 3×500) acumula tramo a tramo:
    // cada webhook agrega su PagoVenta y, al cubrir el total, queda
    // PAGADA_COMPLETA (y se emite el comprobante diferido). Para un pago único,
    // baseAmount = pendiente → mismo comportamiento de antes. Cap a `pendiente`
    // por si el último tramo viniera con sobrante. Fallback al pendiente si el
    // payload no trajera baseAmount (compat).
    const chargeBase = Number(payload?.charge?.baseAmount ?? 0);
    const montoTramo =
      chargeBase > 0 ? Math.min(chargeBase, pendiente) : pendiente;

    // Pasamos el cajero que CREÓ la venta como usuarioId para que el INGRESO
    // Yape entre a SU caja (la misma donde fue el efectivo en un mixto), con
    // skipCajaValidacion para no fallar si su caja ya cerró (registro best-effort).
    const ventaActualizada = await this.ventaService.procesarPago(
      ventaId,
      empresaId,
      {
        metodoPago: metodo,
        monto: montoTramo,
        referencia:
          payload?.payment?.operationCode || payload?.payment?.id || undefined,
      } as any,
      venta.cajeroId ?? undefined,
      { skipCajaValidacion: true },
    );

    // Solo avisamos "venta pagada" (cierra la hoja) cuando quedó COMPLETA. En un
    // split, los tramos intermedios quedan PAGADA_PARCIAL → la hoja avanza al
    // siguiente cobro, no cierra.
    const completa =
      (ventaActualizada as any)?.estado === EstadoVenta.PAGADA_COMPLETA;
    if (completa) {
      this.notificarVentaPagada(empresaId, venta);
    }
    return {
      ok: true,
      accion: completa ? 'pagada' : 'pago-parcial',
      ventaId,
    };
  }

  /**
   * Venta pagada COMPLETA: avisa a la app (FCM realtime) y al CLIENTE por
   * WhatsApp (ventas ONLINE con celular — las del agente IA): "pago validado,
   * tu compra se está preparando" + la pregunta de ENTREGA (el envío se
   * registra DESPUÉS del pago, como en sorteos). El mensaje se guarda en el
   * historial del agente para que entienda la respuesta ("envío"/"recojo").
   * Best-effort: nunca rompe el webhook.
   */
  private notificarVentaPagada(
    empresaId: string,
    venta: {
      id: string;
      codigo: string;
      total: any;
      conEnvio: boolean;
      canalVenta: string;
      telefonoCliente: string | null;
    },
  ): void {
    this.realtime.notifyVentaPagada({ empresaId, ventaId: venta.id });

    if (venta.canalVenta !== 'ONLINE' || !venta.telefonoCliente) return;
    const celularCliente = venta.telefonoCliente;
    const pregunta = venta.conEnvio
      ? '📦 Te avisaremos cuando salga hacia tu agencia.'
      : '📦 ¿La recoges en tienda o te la enviamos por agencia? ' +
        'Escríbeme *recojo* o *envío*.';
    const texto =
      `✅ ¡Tu pago fue confirmado! Recibimos S/ ${Number(venta.total).toFixed(2)}.\n` +
      `🧾 Tu compra *${venta.codigo}* ya se está preparando.\n` +
      `${pregunta}\n¡Gracias por tu compra! 🙌`;
    this.whatsapp
      .enviarTexto(empresaId, celularCliente, texto)
      .then(async (enviado) => {
        if (!enviado) return;
        // Anexar al historial del agente (contexto para el próximo turno).
        const conv = await this.prisma.conversacionWhatsapp.findUnique({
          where: { empresaId_celular: { empresaId, celular: celularCliente } },
        });
        const ctxConv: any = conv?.contexto ?? {};
        const hist = Array.isArray(ctxConv.historialIa)
          ? ctxConv.historialIa
          : [];
        await this.prisma.conversacionWhatsapp.upsert({
          where: { empresaId_celular: { empresaId, celular: celularCliente } },
          create: {
            empresaId,
            celular: celularCliente,
            estado: 'IA',
            contexto: { historialIa: [{ rol: 'assistant', texto }] },
          },
          update: {
            estado: 'IA',
            contexto: {
              ...ctxConv,
              historialIa: [...hist, { rol: 'assistant', texto }].slice(-12),
            },
          },
        });
      })
      .catch((e: Error) =>
        this.logger.warn(
          `Confirmación WhatsApp de venta ${venta.id}: ${e.message}`,
        ),
      );
  }

  /**
   * Auto-validación de VENTAS del agente IA por pago Yape "suelto" (sin
   * charge): el cliente paga el precio REDONDO y el match es como en sorteos
   * — nombre del pagador (bidireccional) + monto exacto + candidata ÚNICA.
   * Sin céntimos raros para el cliente. 0 o 2+ candidatas → validación manual.
   */
  private async autoValidarVentaPorPagoYape(
    empresaId: string,
    pago: {
      id?: string | null;
      senderName?: string | null;
      amount?: number | null;
      operationCode?: string | null;
      provider?: string | null;
    },
  ): Promise<{ accion: string; ventaId?: string }> {
    const monto = Number(pago?.amount ?? 0);
    if (!pago?.senderName || !(monto > 0)) {
      return { accion: 'venta-pago-sin-datos' };
    }
    const referencia = pago.operationCode || pago.id || undefined;

    // Reintentos del webhook: si este pago ya se aplicó a una venta, no doble.
    if (referencia) {
      const usado = await this.prisma.pagoVenta.findFirst({
        where: { referencia, venta: { empresaId } },
        select: { id: true },
      });
      if (usado) return { accion: 'venta-pago-ya-usado' };
    }

    // Candidatas: ventas del agente (ONLINE con celular) pendientes de pago
    // Yape diferido, recientes, con el MONTO EXACTO del pago.
    const desde = new Date(Date.now() - 24 * 3600 * 1000);
    const candidatas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        canalVenta: 'ONLINE',
        estado: EstadoVenta.CONFIRMADA,
        cobroDiferido: true,
        telefonoCliente: { not: null },
        creadoEn: { gte: desde },
        total: monto,
      },
      include: { pagos: true },
    });
    const matches = candidatas.filter((v) =>
      nombresCoinciden(pago.senderName!, v.nombreCliente),
    );
    if (matches.length === 0) return { accion: 'venta-sin-match' };
    if (matches.length > 1) return { accion: 'venta-ambigua' };

    const venta = matches[0];
    const totalPagado = venta.pagos.reduce(
      (s: number, p: { monto: any }) => s + Number(p.monto),
      0,
    );
    const pendiente = Number(venta.total) - totalPagado;
    if (pendiente <= 0) return { accion: 'venta-sin-saldo' };

    const metodo =
      pago.provider === 'plin' ? MetodoPagoVenta.PLIN : MetodoPagoVenta.YAPE;
    const ventaActualizada = await this.ventaService.procesarPago(
      venta.id,
      empresaId,
      {
        metodoPago: metodo,
        monto: Math.min(monto, pendiente),
        referencia,
      } as any,
      venta.cajeroId ?? undefined,
      { skipCajaValidacion: true },
    );
    const completa =
      (ventaActualizada as any)?.estado === EstadoVenta.PAGADA_COMPLETA;
    if (completa) this.notificarVentaPagada(empresaId, venta);
    return {
      accion: completa ? 'venta-auto-validada' : 'venta-pago-parcial',
      ventaId: venta.id,
    };
  }

  /**
   * Verifica que la firma HMAC-SHA256 del body cruda coincida con la esperada.
   * Usa `timingSafeEqual` para evitar ataques de timing.
   */
  verificarFirmaSyncrofact(rawBody: Buffer, firmaRecibida: string): boolean {
    const secret = process.env.SYNCROFACT_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('SYNCROFACT_WEBHOOK_SECRET no está configurado en el entorno');
      return false;
    }
    if (!firmaRecibida || !rawBody) return false;

    const firmaEsperada = createHmac('sha256', secret).update(rawBody).digest('hex');

    const a = Buffer.from(firmaEsperada, 'utf8');
    const b = Buffer.from(firmaRecibida, 'utf8');
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Procesa el payload ya verificado. Retorna {ok:true} siempre que la
   * operación sea coherente, incluso si ignoramos el evento por idempotencia.
   * Las excepciones solo se lanzan para errores no recuperables (config faltante,
   * BD caída, etc.), que devolverán 500 y Syncrofact reintentará.
   */
  async procesar(payload: SyncrofactWebhookPayload, eventHeader?: string): Promise<{
    ok: boolean;
    accion: 'actualizado' | 'ignorado' | 'no_encontrado' | 'no_soportado' | 'test_ok';
    comprobanteId?: string;
  }> {
    const event = payload.event || eventHeader;
    if (!event) throw new BadRequestException('Falta event en payload');

    // webhook.test: payload sintético del botón "Test" del panel admin.
    // No lleva company_id ni data.numero — solo confirmamos que llegó y firmó OK.
    if (event === 'webhook.test') {
      this.logger.info(`Webhook.test recibido (firma válida): ${JSON.stringify(payload.data ?? {})}`);
      return { ok: true, accion: 'test_ok' };
    }

    const data = payload.data ?? {};
    const companyIdSyncrofact = data.company_id;
    if (typeof companyIdSyncrofact !== 'number') {
      throw new BadRequestException('Falta data.company_id');
    }

    // Resolver empresaId de Syncronize desde el companyId de Syncrofact.
    // Lo guardamos en ConfiguracionFacturacion.proveedorConfig.companyId.
    const empresaId = await this.resolverEmpresaId(companyIdSyncrofact);
    if (!empresaId) {
      this.logger.warn(`Webhook recibido para companyId=${companyIdSyncrofact} sin empresa Syncronize asociada`);
      return { ok: true, accion: 'ignorado' };
    }

    // Eventos de Comunicación de Baja: actualizan ComunicacionBaja, no ComprobanteElectronico.
    if (EVENTOS_BAJA.has(event)) {
      return this.procesarEventoBaja(event, empresaId, data);
    }

    // Eventos de Resumen Diario: actualizan ResumenDiario y propagan anulado=true a boletas.
    if (EVENTOS_RC.has(event)) {
      return this.procesarEventoRC(event, empresaId, data);
    }

    // Localizar el comprobante: preferir referencia_interna (nuestro id),
    // fallback a numero + empresaId.
    const comprobante = await this.buscarComprobante(empresaId, data.referencia_interna, data.numero);
    if (!comprobante) {
      this.logger.warn(`Webhook ${event} — comprobante no encontrado (empresa=${empresaId}, num=${data.numero}, ref=${data.referencia_interna})`);
      return { ok: true, accion: 'no_encontrado' };
    }

    // Idempotencia natural: si ya está en un estado terminal, no tocar.
    if (comprobante.sunatStatus === 'ACEPTADO' || comprobante.sunatStatus === 'RECHAZADO') {
      this.logger.info(`Webhook ${event} idempotente — comprobante ${comprobante.id} ya está ${comprobante.sunatStatus}`);
      return { ok: true, accion: 'ignorado', comprobanteId: comprobante.id };
    }

    if (EVENTOS_ACEPTACION.has(event)) {
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobante.id },
        data: { sunatStatus: 'ACEPTADO', estado: 'ACEPTADO' },
      });
      this.logger.info(`Webhook ${event} → comprobante ${comprobante.id} marcado ACEPTADO`);
      return { ok: true, accion: 'actualizado', comprobanteId: comprobante.id };
    }

    if (EVENTOS_RECHAZO.has(event)) {
      // Persistir el código + mensaje SUNAT que viajan en el webhook
      // (`error_code`/`error_message`) para que el monitor muestre el error exacto.
      const errorCode = data.error_code ?? null;
      const errorMessage =
        (typeof data.error_message === 'string' && data.error_message.trim()) ||
        'Rechazado por SUNAT';
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobante.id },
        data: {
          sunatStatus: 'RECHAZADO',
          estado: 'RECHAZADO',
          sunatCodigo: errorCode,
          errorProveedor: errorMessage,
        },
      });
      this.logger.info(
        `Webhook ${event} → comprobante ${comprobante.id} marcado RECHAZADO (SUNAT ${errorCode ?? 's/codigo'}: ${errorMessage})`,
      );
      return { ok: true, accion: 'actualizado', comprobanteId: comprobante.id };
    }

    if (EVENTOS_ANULACION.has(event)) {
      // Anulación: marcamos la flag. El sunatStatus se queda en ACEPTADO
      // (la anulación se registra aparte, no es un cambio de estado SUNAT).
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobante.id },
        data: { anulado: true },
      });
      this.logger.info(`Webhook ${event} → comprobante ${comprobante.id} marcado anulado`);
      return { ok: true, accion: 'actualizado', comprobanteId: comprobante.id };
    }

    // Eventos `.created` o `daily_summary.*` o `plazo.*` no disparan cambios
    // en ComprobanteElectronico — los aceptamos para devolver 200 y no provocar retries.
    this.logger.info(`Webhook ${event} recibido pero sin handler específico — ACK`);
    return { ok: true, accion: 'no_soportado' };
  }

  /**
   * Procesa eventos de Comunicación de Baja. Actualiza la fila de ComunicacionBaja
   * y, si el evento es `voided_document.accepted`, marca todos los comprobantes
   * referenciados como `anulado=true`.
   */
  private async procesarEventoBaja(
    event: string,
    empresaId: string,
    data: SyncrofactWebhookPayload['data'],
  ): Promise<{ ok: boolean; accion: 'actualizado' | 'ignorado' | 'no_encontrado'; comprobanteId?: string }> {
    const proveedorBajaId = data.document_id != null ? String(data.document_id) : null;
    const numero = data.numero ?? null;

    const baja = await this.prisma.comunicacionBaja.findFirst({
      where: {
        empresaId,
        OR: [
          ...(proveedorBajaId ? [{ proveedorBajaId }] : []),
          ...(numero ? [{ numeroCompleto: numero }] : []),
        ],
      },
      select: { id: true, estadoSunat: true, motivoBaja: true },
    });

    if (!baja) {
      this.logger.warn(
        `Webhook ${event} — CDB no encontrada (empresa=${empresaId}, document_id=${proveedorBajaId}, numero=${numero})`,
      );
      return { ok: true, accion: 'no_encontrado' };
    }

    // Idempotencia: si ya está en estado terminal, no tocar.
    if (baja.estadoSunat === 'ACEPTADO' || baja.estadoSunat === 'RECHAZADO') {
      return { ok: true, accion: 'ignorado' };
    }

    const estadoSunat = (data.estado_sunat ?? '').toString().toUpperCase();
    const aceptado = event === 'voided_document.accepted' || estadoSunat === 'ACEPTADO';
    const rechazado = event === 'voided_document.rejected' || estadoSunat === 'RECHAZADO';

    const nuevoEstado = aceptado ? 'ACEPTADO' : rechazado ? 'RECHAZADO' : 'PROCESANDO';

    await this.prisma.$transaction(async (tx) => {
      await tx.comunicacionBaja.update({
        where: { id: baja.id },
        data: {
          estadoSunat: nuevoEstado as any,
          enviadoAProveedor: true,
        },
      });

      if (aceptado) {
        // Marcar comprobantes referenciados como anulados
        const detalles = await tx.detalleComunicacionBaja.findMany({
          where: { comunicacionBajaId: baja.id },
          select: { comprobanteId: true },
        });
        if (detalles.length > 0) {
          await tx.comprobanteElectronico.updateMany({
            where: { id: { in: detalles.map((d) => d.comprobanteId) } },
            data: { anulado: true, motivoAnulacion: baja.motivoBaja },
          });
        }
      }
    });

    this.logger.info(`Webhook ${event} → CDB ${baja.id} marcada ${nuevoEstado}`);
    return { ok: true, accion: 'actualizado' };
  }

  /**
   * Procesa eventos de Resumen Diario (RC). Actualiza la fila de ResumenDiario
   * y, si el evento es `daily_summary.processed` con estado_sunat=ACEPTADO,
   * marca todas las boletas referenciadas como `anulado=true`.
   */
  private async procesarEventoRC(
    event: string,
    empresaId: string,
    data: SyncrofactWebhookPayload['data'],
  ): Promise<{ ok: boolean; accion: 'actualizado' | 'ignorado' | 'no_encontrado'; comprobanteId?: string }> {
    const proveedorResumenId = data.document_id != null ? String(data.document_id) : null;
    const numero = data.numero ?? null;

    const resumen = await this.prisma.resumenDiario.findFirst({
      where: {
        empresaId,
        OR: [
          ...(proveedorResumenId ? [{ proveedorResumenId }] : []),
          ...(numero ? [{ numeroCompleto: numero }] : []),
        ],
      },
      select: { id: true, estadoSunat: true, motivoAnulacion: true },
    });

    if (!resumen) {
      this.logger.warn(
        `Webhook ${event} — RC no encontrado (empresa=${empresaId}, document_id=${proveedorResumenId}, numero=${numero})`,
      );
      return { ok: true, accion: 'no_encontrado' };
    }

    // Idempotencia: si ya está en estado terminal, no tocar.
    if (resumen.estadoSunat === 'ACEPTADO' || resumen.estadoSunat === 'RECHAZADO') {
      return { ok: true, accion: 'ignorado' };
    }

    const estadoSunat = (data.estado_sunat ?? '').toString().toUpperCase();

    // `daily_summary.created` y `daily_summary.sent` no implican estado terminal.
    // Solo `daily_summary.processed` puede traer ACEPTADO/RECHAZADO.
    let nuevoEstado: 'PENDIENTE' | 'PROCESANDO' | 'ACEPTADO' | 'RECHAZADO';
    let aceptado = false;
    if (event === 'daily_summary.processed') {
      aceptado = estadoSunat === 'ACEPTADO';
      const rechazado = estadoSunat === 'RECHAZADO';
      nuevoEstado = aceptado ? 'ACEPTADO' : rechazado ? 'RECHAZADO' : 'PROCESANDO';
    } else if (event === 'daily_summary.sent') {
      nuevoEstado = 'PROCESANDO';
    } else {
      // daily_summary.created — el RC apenas se creó en el proveedor, sigue PENDIENTE.
      nuevoEstado = 'PENDIENTE';
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.resumenDiario.update({
        where: { id: resumen.id },
        data: {
          estadoSunat: nuevoEstado as any,
          enviadoAProveedor: nuevoEstado !== 'PENDIENTE' ? true : undefined,
        },
      });

      if (aceptado) {
        // Marcar boletas referenciadas como anuladas
        const detalles = await tx.detalleResumenDiario.findMany({
          where: { resumenDiarioId: resumen.id },
          select: { comprobanteId: true },
        });
        if (detalles.length > 0) {
          await tx.comprobanteElectronico.updateMany({
            where: { id: { in: detalles.map((d) => d.comprobanteId) } },
            data: { anulado: true, motivoAnulacion: resumen.motivoAnulacion },
          });
        }
      }
    });

    this.logger.info(`Webhook ${event} → RC ${resumen.id} marcado ${nuevoEstado}`);
    return { ok: true, accion: 'actualizado' };
  }

  /**
   * Encuentra la empresa Syncronize cuyo proveedorConfig.companyId coincida
   * con el enviado en el webhook (por Sede o por ConfiguracionFacturacion global).
   */
  private async resolverEmpresaId(companyIdSyncrofact: number): Promise<string | null> {
    // 1) Buscar en ConfiguracionFacturacion (nivel empresa)
    const config = await this.prisma.configuracionFacturacion.findFirst({
      where: {
        proveedorConfig: { path: ['companyId'], equals: companyIdSyncrofact },
      },
      select: { empresaId: true },
    });
    if (config) return config.empresaId;

    // 2) Fallback: buscar en Sede (multi-sede con companyId propio)
    const sede = await this.prisma.sede.findFirst({
      where: {
        proveedorConfig: { path: ['companyId'], equals: companyIdSyncrofact },
      },
      select: { empresaId: true },
    });
    return sede?.empresaId ?? null;
  }

  /**
   * Busca un ComprobanteElectronico primero por referencia_interna (nuestro id),
   * fallback a serie+correlativo derivado de `numero`.
   */
  private async buscarComprobante(
    empresaId: string,
    referenciaInterna: string | undefined,
    numero: string | undefined,
  ): Promise<{ id: string; sunatStatus: string } | null> {
    if (referenciaInterna) {
      const c = await this.prisma.comprobanteElectronico.findFirst({
        where: { id: referenciaInterna, empresaId },
        select: { id: true, sunatStatus: true },
      });
      if (c) return c;
    }
    if (numero) {
      // "F002-00000002" → serie="F002", correlativo="00000002"
      const [serie, correlativo] = numero.split('-');
      if (serie && correlativo) {
        const c = await this.prisma.comprobanteElectronico.findFirst({
          where: { empresaId, serie, correlativo },
          select: { id: true, sunatStatus: true },
        });
        if (c) return c;
      }
    }
    return null;
  }
}
