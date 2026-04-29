import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';

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

@Injectable()
export class WebhooksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('WebhooksService');
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
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobante.id },
        data: { sunatStatus: 'RECHAZADO', estado: 'RECHAZADO' },
      });
      this.logger.info(`Webhook ${event} → comprobante ${comprobante.id} marcado RECHAZADO`);
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
