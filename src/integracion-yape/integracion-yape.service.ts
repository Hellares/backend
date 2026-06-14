import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

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
    const cfg = accountId
      ? await this.prisma.integracionYape.findFirst({ where: { accountId } })
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
}
