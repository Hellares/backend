import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

/**
 * Receptor de webhooks de proveedores externos.
 *
 * ⚠ Estos endpoints son PÚBLICOS (sin JwtAuthGuard global). La autenticación
 * se hace por firma HMAC del body con un secret compartido. Cualquier
 * endpoint nuevo aquí debe validar su firma antes de procesar.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Recepción de eventos de Syncrofact.
   * Headers esperados:
   *   X-Webhook-Signature: HMAC-SHA256(body, SYNCROFACT_WEBHOOK_SECRET) en hex
   *   X-Webhook-Event:     nombre del evento (ej. "invoice.accepted")
   */
  @Post('syncrofact')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recibe eventos de Syncrofact (firmados HMAC-SHA256)' })
  async recibirSyncrofact(
    @Req() req: Request,
    @Headers('x-webhook-signature') signature: string,
    @Headers('x-webhook-event') eventHeader: string,
  ) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      throw new BadRequestException('Raw body no disponible — revisar configuración main.ts');
    }

    const valido = this.webhooksService.verificarFirmaSyncrofact(rawBody, signature);
    if (!valido) {
      throw new UnauthorizedException('Firma inválida');
    }

    const payload = req.body;
    const result = await this.webhooksService.procesar(payload, eventHeader);

    // 200 OK siempre que haya procesado (incluso si ignoramos por idempotencia).
    // Errores no recuperables se propagan (500) y Syncrofact reintenta.
    return result;
  }

  /**
   * Recepción de confirmaciones de pago de api-yape (Yape/Plin).
   * Header: X-Yape-Signature: sha256=HMAC-SHA256(body, webhookSecret de la empresa)
   */
  @Post('yape')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recibe pagos confirmados de api-yape (Yape/Plin)' })
  async recibirYape(
    @Req() req: Request,
    @Headers('x-yape-signature') signature: string,
  ) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      throw new BadRequestException('Raw body no disponible — revisar main.ts');
    }
    return this.webhooksService.procesarPagoYape(rawBody, signature);
  }
}
