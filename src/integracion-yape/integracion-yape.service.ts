import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Rol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateIntegracionYapeDto,
  IntegracionYapeResponseDto,
  ProbarConexionResponseDto,
} from './dto/integracion-yape.dto';

/**
 * Integración con api-yape (servicio externo de validación de pagos Yape/Plin).
 * Solo depende de Prisma para evitar dependencias circulares con VentaModule.
 * La orquestación del webhook (que marca la venta pagada) vive en WebhooksModule.
 */
@Injectable()
export class IntegracionYapeService {
  private readonly logger = new Logger(IntegracionYapeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un cobro en api-yape para una venta y devuelve el monto que el cliente
   * debe pagar. Si la integración no está configurada/habilitada o api-yape no
   * responde, devuelve null → la venta sigue con cobro MANUAL (nunca se bloquea).
   */
  async crearCobro(args: {
    empresaId: string;
    ventaId: string;
    monto: number;
    cajaId?: string | null;
  }): Promise<{ payAmount: number; chargeId?: string } | null> {
    const cfg = await this.prisma.integracionYape.findUnique({
      where: { empresaId: args.empresaId },
    });
    if (!cfg || !cfg.habilitado) return null;
    try {
      const res = await fetch(`${cfg.apiBaseUrl}/api/charges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.accountApiKey,
        },
        body: JSON.stringify({
          amount: args.monto,
          reference: args.ventaId,
          cajaId: args.cajaId ?? undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(
          `api-yape /charges respondió ${res.status} (venta ${args.ventaId})`,
        );
        return null;
      }
      const data: any = await res.json();
      return { payAmount: Number(data.payAmount), chargeId: data?.charge?.id };
    } catch (e) {
      this.logger.warn(
        `api-yape no disponible (venta ${args.ventaId}): ${(e as Error).message}`,
      );
      return null; // fallback manual
    }
  }

  /**
   * Cancela el cobro pendiente de una venta en api-yape (por reference=ventaId).
   * Se llama cuando la venta se confirma/anula por otra vía (ej. pago manual
   * porque la notificación de Yape nunca llegó): libera el monto único reservado
   * al instante para que la próxima venta del mismo monto no salga con un céntimo
   * menos. Resiliente: si la integración no aplica o api-yape no responde, no
   * hace nada (nunca bloquea el flujo de venta). Devuelve cuántos cobros canceló.
   */
  async cancelarCobro(args: {
    empresaId: string;
    ventaId: string;
  }): Promise<number> {
    const cfg = await this.prisma.integracionYape.findUnique({
      where: { empresaId: args.empresaId },
    });
    if (!cfg || !cfg.habilitado) return 0;
    try {
      const res = await fetch(`${cfg.apiBaseUrl}/api/charges/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.accountApiKey,
        },
        body: JSON.stringify({ reference: args.ventaId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(
          `api-yape /charges/cancel respondió ${res.status} (venta ${args.ventaId})`,
        );
        return 0;
      }
      const data: any = await res.json();
      return Number(data?.canceled ?? 0);
    } catch (e) {
      this.logger.warn(
        `api-yape no disponible al cancelar cobro (venta ${args.ventaId}): ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Pagos RECIBIDOS recientes que NO matchearon ningún charge (status
   * "received" en api-yape) — son los yapes "sueltos": participaciones
   * de sorteos, pagos espontáneos. Se usan para sugerir el match por
   * nombre en la cola de validación. Resiliente: [] si la integración
   * no aplica o api-yape no responde.
   */
  async listarPagosRecientes(
    empresaId: string,
    opts?: { horas?: number },
  ): Promise<
    {
      id: string;
      senderName: string | null;
      amount: number;
      provider: string | null;
      receivedAt: string;
      /** Código de operación de Yape — PagoVenta.referencia lo usa cuando
       *  existe (si no, el id): necesario para cruzar pagos ya consumidos. */
      operationCode: string | null;
    }[]
  > {
    const cfg = await this.prisma.integracionYape.findUnique({
      where: { empresaId },
    });
    if (!cfg || !cfg.habilitado) return [];
    try {
      const res = await fetch(
        `${cfg.apiBaseUrl}/api/payments?limit=100&status=received`,
        {
          headers: { 'x-api-key': cfg.accountApiKey },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) {
        this.logger.warn(`api-yape /payments respondió ${res.status}`);
        return [];
      }
      const data: any = await res.json();
      const corte = Date.now() - (opts?.horas ?? 24) * 3600_000;
      return ((data?.payments ?? []) as any[])
        .filter((p) => {
          const t = new Date(p.receivedAt ?? p.createdAt ?? 0).getTime();
          return Number.isFinite(t) && t >= corte;
        })
        .map((p) => ({
          id: String(p.id),
          senderName: p.senderName ?? null,
          amount: Number(p.amount ?? 0),
          provider: p.provider ?? null,
          receivedAt: String(p.receivedAt ?? p.createdAt ?? ''),
          operationCode: p.operationCode ? String(p.operationCode) : null,
        }));
    } catch (e) {
      this.logger.warn(
        `api-yape no disponible al listar pagos: ${(e as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Verifica la firma HMAC del webhook entrante con el secret de la empresa
   * dueña de la cuenta api-yape (resuelta por payload.account.id). Devuelve la
   * empresa + el payload, o null si la cuenta no está mapeada. Lanza
   * UnauthorizedException si la firma no coincide.
   */
  async verificarWebhook(
    rawBody: Buffer,
    firmaRecibida: string,
  ): Promise<{ empresaId: string; payload: any } | null> {
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new UnauthorizedException('Payload inválido');
    }
    const accountId: string | undefined = payload?.account?.id;
    // accountId es @unique: la resolución cuenta→empresa es determinística.
    const cfg = accountId
      ? await this.prisma.integracionYape.findUnique({ where: { accountId } })
      : null;
    if (!cfg) {
      this.logger.warn(`Webhook api-yape: cuenta no mapeada (${accountId})`);
      return null;
    }
    const esperada = createHmac('sha256', cfg.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const recibida = (firmaRecibida || '').replace(/^sha256=/, '');
    const a = Buffer.from(esperada, 'utf8');
    const b = Buffer.from(recibida, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Firma inválida');
    }
    return { empresaId: cfg.empresaId, payload };
  }

  // ===========================================================================
  // Gestión de la configuración (panel admin de la empresa)
  // ===========================================================================

  /**
   * Verifica que el usuario sea administrador de la empresa. Mismo criterio que
   * EmpresaService.updateConfiguracion (SUPER_ADMIN / EMPRESA_ADMIN activos).
   */
  private async verificarAdmin(empresaId: string, userId: string): Promise<void> {
    const userRole = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: { in: [Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN] },
      },
    });
    if (!userRole) {
      throw new ForbiddenException(
        'No tienes permisos para gestionar la integración Yape',
      );
    }
  }

  /** Máscara segura de un secreto: prefijo (hasta el primer '_') + últimos 4. */
  private enmascarar(secreto: string | null | undefined): string | null {
    if (!secreto) return null;
    const us = secreto.indexOf('_');
    const prefijo = us >= 0 ? secreto.slice(0, us + 5) : secreto.slice(0, 4);
    const sufijo = secreto.slice(-4);
    return `${prefijo}…${sufijo}`;
  }

  /** URL del webhook receptor de Syncronize (a configurar en api-yape). */
  private webhookUrlPara(apiBaseUrl: string | null | undefined): string {
    const esBeta = (apiBaseUrl ?? '').includes('beta');
    return esBeta
      ? 'https://saas-beta.syncronize.net.pe/api/webhooks/yape'
      : 'https://saas.syncronize.net.pe/api/webhooks/yape';
  }

  /** Devuelve la config de la empresa con los secretos enmascarados. */
  async getConfig(
    empresaId: string,
    userId: string,
  ): Promise<IntegracionYapeResponseDto> {
    await this.verificarAdmin(empresaId, userId);
    const cfg = await this.prisma.integracionYape.findUnique({
      where: { empresaId },
    });
    return {
      configurado: !!cfg,
      habilitado: cfg?.habilitado ?? false,
      apiBaseUrl: cfg?.apiBaseUrl ?? null,
      accountId: cfg?.accountId ?? null,
      accountApiKeyMask: this.enmascarar(cfg?.accountApiKey),
      webhookSecretMask: this.enmascarar(cfg?.webhookSecret),
      webhookUrl: this.webhookUrlPara(cfg?.apiBaseUrl),
      celular: cfg?.celular ?? null,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  /**
   * Crea o actualiza la integración. Los secretos solo se reemplazan si vienen
   * con valor (en blanco = conservar el actual). Al crear desde cero, todos los
   * campos requeridos deben venir.
   */
  async upsertConfig(
    empresaId: string,
    userId: string,
    dto: UpdateIntegracionYapeDto,
  ): Promise<IntegracionYapeResponseDto> {
    await this.verificarAdmin(empresaId, userId);

    const existente = await this.prisma.integracionYape.findUnique({
      where: { empresaId },
    });

    const apiKey = dto.accountApiKey?.trim();
    const whSecret = dto.webhookSecret?.trim();

    if (!existente) {
      // Creación: exige todos los campos (las columnas son NOT NULL).
      const faltan: string[] = [];
      if (!dto.apiBaseUrl?.trim()) faltan.push('apiBaseUrl');
      if (!apiKey) faltan.push('accountApiKey');
      if (!dto.accountId?.trim()) faltan.push('accountId');
      if (!whSecret) faltan.push('webhookSecret');
      if (faltan.length) {
        throw new BadRequestException(
          `Faltan campos para crear la integración: ${faltan.join(', ')}`,
        );
      }
      await this.prisma.integracionYape.create({
        data: {
          empresaId,
          apiBaseUrl: dto.apiBaseUrl!.trim(),
          accountApiKey: apiKey!,
          accountId: dto.accountId!.trim(),
          webhookSecret: whSecret!,
          habilitado: dto.habilitado ?? true,
          celular: dto.celular?.trim() || null,
        },
      });
    } else {
      await this.prisma.integracionYape.update({
        where: { empresaId },
        data: {
          ...(dto.apiBaseUrl?.trim() && { apiBaseUrl: dto.apiBaseUrl.trim() }),
          ...(dto.accountId?.trim() && { accountId: dto.accountId.trim() }),
          ...(apiKey && { accountApiKey: apiKey }),
          ...(whSecret && { webhookSecret: whSecret }),
          ...(dto.habilitado !== undefined && { habilitado: dto.habilitado }),
          // '' = limpiar el número; undefined = conservar.
          ...(dto.celular !== undefined && { celular: dto.celular.trim() || null }),
        },
      });
    }

    this.logger.log(`IntegracionYape actualizada (empresa ${empresaId})`);
    return this.getConfig(empresaId, userId);
  }

  /**
   * Prueba la conexión con api-yape: crea un cobro de S/1 con referencia de
   * prueba y lo cancela acto seguido. No deja rastro de cobro pendiente.
   */
  async probarConexion(
    empresaId: string,
    userId: string,
  ): Promise<ProbarConexionResponseDto> {
    await this.verificarAdmin(empresaId, userId);
    const cfg = await this.prisma.integracionYape.findUnique({
      where: { empresaId },
    });
    if (!cfg) {
      throw new BadRequestException('La integración Yape no está configurada');
    }
    const reference = `TEST-CONEXION-${empresaId}`;
    try {
      const res = await fetch(`${cfg.apiBaseUrl}/api/charges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.accountApiKey,
        },
        body: JSON.stringify({ amount: 1, reference }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const msg =
          res.status === 401
            ? 'api-yape rechazó la API key (401). Revisa accountApiKey.'
            : `api-yape respondió ${res.status}.`;
        return { ok: false, mensaje: msg };
      }
      // Limpieza: cancelar el cobro de prueba (best-effort).
      await fetch(`${cfg.apiBaseUrl}/api/charges/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.accountApiKey,
        },
        body: JSON.stringify({ reference }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined);
      return {
        ok: true,
        mensaje: 'Conexión exitosa con api-yape. La cuenta está operativa.',
      };
    } catch (e) {
      return {
        ok: false,
        mensaje: `No se pudo contactar api-yape: ${(e as Error).message}`,
      };
    }
  }
}
