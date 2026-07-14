import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  EstadoWhatsappInstancia,
  Rol,
  SorteoPremio,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionApiService } from './evolution-api.service';
import { WhatsappBotService } from './whatsapp-bot.service';
import { UpdateWhatsappDto } from './dto/whatsapp.dto';
import { PLANTILLA_PAGO_DEFAULT, renderPlantilla } from './plantilla.util';

/**
 * Plantilla default del mensaje "premio enviado". Las líneas cuyas
 * variables queden TODAS vacías se eliminan del mensaje final (p.ej.
 * un premio sin clave de recojo no muestra esa línea).
 */
export const PLANTILLA_PREMIO_DEFAULT = [
  '{saludo} {ganador} 🎉',
  '',
  '*PREMIO ENVIADO* 📦',
  'Su premio: {premio}',
  'Agencia: {agencia} → {destino}',
  'Orden: {orden} · Código: {codigo}',
  'Clave de recojo: *{clave}* (la agencia la pedirá para entregarle)',
  '',
  'Le compartimos el ticket de envío como constancia.',
  '¡Gracias por su preferencia! 😊',
  '_{empresa}_',
].join('\n');

/**
 * WhatsApp por empresa vía Evolution API: vinculación con QR, estado por
 * webhook y envío automático del ticket del premio. Todo el envío es
 * best-effort — NUNCA bloquea el flujo que lo dispara.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionApiService,
    private readonly bot: WhatsappBotService,
  ) {}

  // ── Helpers de identidad/URLs ─────────────────────────────────────────

  private instanceNameFor(empresaId: string): string {
    const prefix = process.env.EVOLUTION_INSTANCE_PREFIX ?? 'dev';
    return `${prefix}_${empresaId}`;
  }

  /** Token del webhook: derivado de la API key (no expone la key). */
  private get webhookToken(): string {
    return createHash('sha256')
      .update(`${process.env.EVOLUTION_API_KEY ?? ''}:whatsapp-webhook`)
      .digest('hex')
      .slice(0, 32);
  }

  private get webhookUrl(): string {
    const base = process.env.WHATSAPP_WEBHOOK_BASE ?? '';
    return `${base}/api/whatsapp/webhook/${this.webhookToken}`;
  }

  /** Mismo criterio que IntegracionYape: solo admins de la empresa. */
  private async verificarAdmin(
    empresaId: string,
    userId: string,
  ): Promise<void> {
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
        'No tienes permisos para gestionar la integración de WhatsApp',
      );
    }
  }

  // ── Vinculación / configuración ──────────────────────────────────────

  /**
   * Crea (si hace falta) la instancia en Evolution y devuelve el QR para
   * escanear desde WhatsApp > Dispositivos vinculados. Si ya estaba
   * conectado devuelve el estado sin QR.
   */
  async vincular(empresaId: string, userId: string) {
    await this.verificarAdmin(empresaId, userId);
    if (!this.evolution.disponible) {
      throw new BadRequestException(
        'El servicio de WhatsApp no está configurado en este ambiente',
      );
    }
    const instanceName = this.instanceNameFor(empresaId);
    await this.prisma.integracionWhatsapp.upsert({
      where: { empresaId },
      create: { empresaId, instanceName },
      update: {},
    });

    await this.evolution.createInstance(instanceName, this.webhookUrl);
    // La instancia podía existir de antes: asegurar webhook y settings
    // de privacidad igual (solo mensajes; llamadas/grupos intactos).
    await this.evolution
      .setWebhook(instanceName, this.webhookUrl)
      .catch((e) =>
        this.logger.warn(`setWebhook ${instanceName}: ${e.message}`),
      );
    await this.evolution
      .setSettings(instanceName)
      .catch((e) =>
        this.logger.warn(`setSettings ${instanceName}: ${e.message}`),
      );

    const state = await this.evolution.connectionState(instanceName);
    if (state === 'open') {
      await this.marcarConectado(instanceName);
      return { estado: EstadoWhatsappInstancia.CONECTADO, qrBase64: null };
    }

    const qr = await this.evolution.connect(instanceName);
    await this.prisma.integracionWhatsapp.update({
      where: { empresaId },
      data: { estado: EstadoWhatsappInstancia.PENDIENTE_QR },
    });
    return {
      estado: EstadoWhatsappInstancia.PENDIENTE_QR,
      // Evolution devuelve el QR como data URI en base64.
      qrBase64: qr?.base64 ?? null,
      pairingCode: qr?.pairingCode ?? null,
    };
  }

  /** Config + estado vivo (sincroniza la fila si Evolution difiere). */
  async getConfig(empresaId: string, userId: string) {
    await this.verificarAdmin(empresaId, userId);
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });

    let estado = cfg?.estado ?? null;
    if (cfg && this.evolution.disponible) {
      const state = await this.evolution
        .connectionState(cfg.instanceName)
        .catch(() => undefined);
      if (state !== undefined) {
        const mapeado =
          state === 'open'
            ? EstadoWhatsappInstancia.CONECTADO
            : state === 'connecting'
              ? EstadoWhatsappInstancia.PENDIENTE_QR
              : EstadoWhatsappInstancia.DESCONECTADO;
        if (mapeado !== cfg.estado) {
          if (mapeado === EstadoWhatsappInstancia.CONECTADO) {
            await this.marcarConectado(cfg.instanceName);
          } else {
            await this.prisma.integracionWhatsapp.update({
              where: { id: cfg.id },
              data: { estado: mapeado },
            });
          }
          estado = mapeado;
        }
      }
    }

    return {
      configurado: !!cfg,
      disponible: this.evolution.disponible,
      estado,
      numero: cfg?.numero ?? null,
      habilitado: cfg?.habilitado ?? true,
      plantillaPremio: cfg?.plantillaPremio ?? null,
      plantillaDefault: PLANTILLA_PREMIO_DEFAULT,
      plantillaPago: cfg?.plantillaPago ?? null,
      plantillaPagoDefault: PLANTILLA_PAGO_DEFAULT,
      agenciaEnvio: cfg?.agenciaEnvio ?? 'SHALOM',
      conectadoEn: cfg?.conectadoEn ?? null,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  /** Plantilla y/o habilitado ('' en plantilla = volver a la default). */
  async updateConfig(
    empresaId: string,
    userId: string,
    dto: UpdateWhatsappDto,
  ) {
    await this.verificarAdmin(empresaId, userId);
    const instanceName = this.instanceNameFor(empresaId);
    await this.prisma.integracionWhatsapp.upsert({
      where: { empresaId },
      create: {
        empresaId,
        instanceName,
        plantillaPremio: dto.plantillaPremio?.trim() || null,
        plantillaPago: dto.plantillaPago?.trim() || null,
        // '' o undefined → default SHALOM (columna NOT NULL).
        ...(dto.agenciaEnvio?.trim() && {
          agenciaEnvio: dto.agenciaEnvio.trim().toUpperCase(),
        }),
        habilitado: dto.habilitado ?? true,
      },
      update: {
        ...(dto.plantillaPremio !== undefined && {
          plantillaPremio: dto.plantillaPremio.trim() || null,
        }),
        ...(dto.plantillaPago !== undefined && {
          plantillaPago: dto.plantillaPago.trim() || null,
        }),
        ...(dto.agenciaEnvio !== undefined && {
          agenciaEnvio: dto.agenciaEnvio.trim().toUpperCase() || 'SHALOM',
        }),
        ...(dto.habilitado !== undefined && { habilitado: dto.habilitado }),
      },
    });
    return this.getConfig(empresaId, userId);
  }

  /** Cierra sesión y elimina la instancia (la plantilla se conserva). */
  async desvincular(empresaId: string, userId: string) {
    await this.verificarAdmin(empresaId, userId);
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });
    if (!cfg) throw new BadRequestException('WhatsApp no está vinculado');
    if (this.evolution.disponible) {
      await this.evolution.logout(cfg.instanceName);
      await this.evolution.deleteInstance(cfg.instanceName);
    }
    await this.prisma.integracionWhatsapp.update({
      where: { id: cfg.id },
      data: {
        estado: EstadoWhatsappInstancia.DESCONECTADO,
        numero: null,
      },
    });
    return { ok: true };
  }

  // ── Webhook de Evolution (CONNECTION_UPDATE) ─────────────────────────

  async procesarWebhook(token: string, body: any) {
    if (token !== this.webhookToken) {
      throw new UnauthorizedException('Token inválido');
    }
    const event: string = body?.event ?? '';
    const instanceName: string = body?.instance ?? '';
    if (!instanceName) return { ok: true };

    if (event === 'connection.update') {
      const state: string = body?.data?.state ?? '';
      this.logger.log(
        `WhatsApp ${instanceName}: connection.update → ${state}`,
      );
      if (state === 'open') {
        await this.marcarConectado(instanceName);
      } else if (state === 'close') {
        await this.prisma.integracionWhatsapp.updateMany({
          where: { instanceName },
          data: { estado: EstadoWhatsappInstancia.DESCONECTADO },
        });
      }
      return { ok: true };
    }

    if (event === 'messages.upsert') {
      // Puede venir un objeto o un array de mensajes.
      const items = Array.isArray(body?.data) ? body.data : [body?.data];
      for (const m of items) {
        const jid: string = m?.key?.remoteJid ?? '';
        // Solo chats directos de texto escritos POR el cliente.
        if (
          !jid ||
          m?.key?.fromMe ||
          jid.endsWith('@g.us') ||
          jid.startsWith('status@')
        ) {
          continue;
        }
        const texto: string | undefined =
          m?.message?.conversation ?? m?.message?.extendedTextMessage?.text;
        if (!texto?.trim()) continue;
        const celular = jid.split('@')[0].split(':')[0];
        // Best-effort: el bot nunca debe tumbar el webhook.
        await this.bot
          .procesarMensaje(instanceName, celular, texto)
          .catch((e) =>
            this.logger.warn(`Bot ${instanceName}: ${e.message}`),
          );
      }
      return { ok: true };
    }

    return { ok: true };
  }

  /**
   * Tras validar el pago de un participante: el bot confirma el ticket
   * y pide/confirma los datos de envío (deja la conversación en el paso
   * correspondiente). Best-effort.
   */
  async notificarActivacionParticipante(
    empresaId: string,
    participanteId: string,
  ): Promise<boolean> {
    return this.bot.notificarActivacionParticipante(empresaId, participanteId);
  }

  /**
   * Texto simple al número indicado desde el WhatsApp de la empresa
   * (best-effort). true si salió.
   */
  async enviarTexto(
    empresaId: string,
    celular: string,
    texto: string,
  ): Promise<boolean> {
    if (!this.evolution.disponible) return false;
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });
    if (
      !cfg ||
      !cfg.habilitado ||
      cfg.estado !== EstadoWhatsappInstancia.CONECTADO
    ) {
      return false;
    }
    await this.evolution.sendText({
      instanceName: cfg.instanceName,
      number: this.normalizarCelular(celular),
      text: texto,
    });
    return true;
  }

  /** CONECTADO + número (ownerJid) — usado por webhook y sync de estado. */
  private async marcarConectado(instanceName: string) {
    let numero: string | null = null;
    try {
      const info = await this.evolution.fetchInstance(instanceName);
      const jid: string | undefined = info?.ownerJid ?? info?.instance?.owner;
      if (jid) numero = jid.split('@')[0];
    } catch {
      // informativo — no bloquea
    }
    await this.prisma.integracionWhatsapp.updateMany({
      where: { instanceName },
      data: {
        estado: EstadoWhatsappInstancia.CONECTADO,
        conectadoEn: new Date(),
        ...(numero && { numero }),
      },
    });
  }

  // ── Envío del ticket del premio ──────────────────────────────────────

  /**
   * Envía la imagen del ticket + mensaje al ganador. Devuelve true si
   * salió; false si la empresa no tiene WhatsApp operativo o el premio
   * no tiene celular. Lanza solo errores de envío (el caller decide).
   */
  async enviarTicketPremio(
    empresaId: string,
    premioId: string,
    mediaUrl: string,
  ): Promise<boolean> {
    if (!this.evolution.disponible) return false;
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });
    if (
      !cfg ||
      !cfg.habilitado ||
      cfg.estado !== EstadoWhatsappInstancia.CONECTADO
    ) {
      return false;
    }
    const premio = await this.prisma.sorteoPremio.findUnique({
      where: { id: premioId },
    });
    if (!premio?.ganadorCelular?.trim()) return false;

    // {empresa} = nombre COMERCIAL (la marca que ve el cliente, misma
    // fuente que los documentos); fallback a la razón social.
    const [empresa, configDocs] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true },
      }),
      this.prisma.configuracionDocumentos.findUnique({
        where: { empresaId },
        select: { nombreComercial: true },
      }),
    ]);
    const caption = this.renderPlantillaPremio(
      cfg.plantillaPremio,
      premio,
      configDocs?.nombreComercial?.trim() || empresa?.nombre || '',
    );
    await this.evolution.sendImage({
      instanceName: cfg.instanceName,
      number: this.normalizarCelular(premio.ganadorCelular),
      mediaUrl,
      caption,
    });
    this.logger.log(
      `Ticket de premio ${premioId} enviado por WhatsApp (empresa ${empresaId})`,
    );
    return true;
  }

  // ── Plantilla ────────────────────────────────────────────────────────

  private renderPlantillaPremio(
    plantilla: string | null,
    premio: SorteoPremio,
    empresaNombre: string,
  ): string {
    const valores: Record<string, string> = {
      saludo: this.saludoLima(),
      ganador: premio.ganadorNombre ?? '',
      premio: premio.descripcion ?? '',
      agencia: premio.agenciaNombre ?? '',
      destino: [premio.destinoProvincia, premio.destinoDepartamento]
        .filter((s) => s && s.trim())
        .join(', '),
      orden: premio.envioNumeroOrden ?? '',
      codigo: premio.envioCodigo ?? '',
      clave: premio.envioClave ?? '',
      empresa: empresaNombre,
    };
    return renderPlantilla(
      plantilla?.trim() || PLANTILLA_PREMIO_DEFAULT,
      valores,
    );
  }

  /** Saludo según la hora de Perú (UTC-5, sin horario de verano). */
  private saludoLima(): string {
    const horaLima = (new Date().getUTCHours() + 24 - 5) % 24;
    if (horaLima >= 5 && horaLima < 12) return 'Buenos días';
    if (horaLima < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  /** Celular peruano de 9 dígitos → 51XXXXXXXXX (mismo criterio app). */
  private normalizarCelular(celular: string): string {
    let phone = celular.replace(/[^\d+]/g, '');
    if (phone.startsWith('+')) phone = phone.slice(1);
    else if (phone.startsWith('00')) phone = phone.slice(2);
    else if (phone.length <= 10) {
      phone = phone.startsWith('0') ? `51${phone.slice(1)}` : `51${phone}`;
    }
    return phone;
  }
}
