import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente HTTP de Evolution API (WhatsApp no oficial). El container
 * `evolution-api` vive en la red docker interna SIN puerto público:
 * solo los backends le hablan, siempre con la API key global.
 */
@Injectable()
export class EvolutionApiService {
  private readonly logger = new Logger(EvolutionApiService.name);

  private get baseUrl(): string {
    return process.env.EVOLUTION_URL ?? 'http://evolution-api:8080';
  }

  private get apiKey(): string {
    return process.env.EVOLUTION_API_KEY ?? '';
  }

  /** false si el ambiente no tiene Evolution configurado (dev local). */
  get disponible(): boolean {
    return !!process.env.EVOLUTION_URL && !!process.env.EVOLUTION_API_KEY;
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detalle =
        typeof data === 'string' ? data : JSON.stringify(data ?? {});
      const err: any = new Error(
        `Evolution ${method} ${path} → ${res.status}: ${detalle}`.slice(0, 400),
      );
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data as T;
  }

  private webhookConfig(webhookUrl: string) {
    return {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      // MESSAGES_UPSERT alimenta el bot de sorteos (solo se procesa,
      // nunca se almacena el contenido).
      events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
    };
  }

  /**
   * Settings de privacidad de la instancia — SOLO enviamos mensajes:
   * no tocar llamadas (siguen sonando solo en el celular), ignorar
   * grupos, no marcar leídos, no sincronizar historial.
   */
  private privacySettings() {
    return {
      rejectCall: false, // no interferir con las llamadas del negocio
      msgCall: '',
      groupsIgnore: true, // los grupos no se procesan
      alwaysOnline: false,
      readMessages: false, // no marcar como leído lo que le escriban
      readStatus: false,
      syncFullHistory: false, // nunca traer el historial de chats
    };
  }

  /** Crea la instancia (idempotente: "ya existe" no es error). */
  async createInstance(instanceName: string, webhookUrl: string) {
    try {
      return await this.request('POST', '/instance/create', {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
        webhook: this.webhookConfig(webhookUrl),
        ...this.privacySettings(),
      });
    } catch (e: any) {
      // 403: "This name is already in use" — la instancia ya existe.
      if (e.status === 403) return null;
      throw e;
    }
  }

  /** (Re)aplica los settings de privacidad (instancias ya existentes). */
  async setSettings(instanceName: string) {
    return this.request(
      'POST',
      `/settings/set/${instanceName}`,
      this.privacySettings(),
    );
  }

  /** (Re)apunta el webhook de la instancia al backend del ambiente. */
  async setWebhook(instanceName: string, webhookUrl: string) {
    return this.request('POST', `/webhook/set/${instanceName}`, {
      webhook: this.webhookConfig(webhookUrl),
    });
  }

  /**
   * QR para vincular: { base64, code, pairingCode }. Con `numero`
   * (formato 51XXXXXXXXX) Evolution devuelve además el pairing code, que
   * evita escanear: se escribe en el teléfono.
   */
  async connect(instanceName: string, numero?: string): Promise<any> {
    const qs = numero ? `?number=${encodeURIComponent(numero)}` : '';
    return this.request('GET', `/instance/connect/${instanceName}${qs}`);
  }

  /** 'open' | 'connecting' | 'close' — null si la instancia no existe. */
  async connectionState(instanceName: string): Promise<string | null> {
    try {
      const r = await this.request(
        'GET',
        `/instance/connectionState/${instanceName}`,
      );
      return r?.instance?.state ?? null;
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Datos de la instancia (ownerJid = número vinculado) o null. */
  async fetchInstance(instanceName: string): Promise<any | null> {
    const r = await this.request(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    );
    const list = Array.isArray(r) ? r : r ? [r] : [];
    return (
      list.find(
        (i: any) => (i?.name ?? i?.instance?.instanceName) === instanceName,
      ) ??
      list[0] ??
      null
    );
  }

  /** Cierra sesión de WhatsApp (best-effort: 400/404 = ya estaba). */
  async logout(instanceName: string) {
    try {
      return await this.request('DELETE', `/instance/logout/${instanceName}`);
    } catch (e: any) {
      if (e.status === 400 || e.status === 404) return null;
      throw e;
    }
  }

  /** Elimina la instancia por completo (best-effort). */
  async deleteInstance(instanceName: string) {
    try {
      return await this.request('DELETE', `/instance/delete/${instanceName}`);
    } catch (e: any) {
      if (e.status === 400 || e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Imagen + caption a un número (formato 51XXXXXXXXX, no necesita estar
   * agendado). `media` acepta URL pública (Evolution la descarga) o
   * base64 directo (imágenes generadas en el backend).
   */
  async sendImage(args: {
    instanceName: string;
    number: string;
    mediaUrl?: string;
    base64?: string;
    caption: string;
    fileName?: string;
    mimetype?: string;
  }) {
    return this.request('POST', `/message/sendMedia/${args.instanceName}`, {
      number: args.number,
      mediatype: 'image',
      mimetype: args.mimetype ?? 'image/jpeg',
      media: args.base64 ?? args.mediaUrl,
      fileName: args.fileName ?? 'ticket-envio.jpg',
      caption: args.caption,
    });
  }

  /**
   * Documento (PDF) a un número. `media` acepta base64 directo — no
   * necesita URL pública (Evolution lo sube a WhatsApp).
   */
  async sendDocument(args: {
    instanceName: string;
    number: string;
    base64: string;
    fileName: string;
    caption?: string;
    mimetype?: string;
  }) {
    return this.request('POST', `/message/sendMedia/${args.instanceName}`, {
      number: args.number,
      mediatype: 'document',
      mimetype: args.mimetype ?? 'application/pdf',
      media: args.base64,
      fileName: args.fileName,
      caption: args.caption ?? '',
    });
  }

  /** Mensaje de texto simple. */
  async sendText(args: {
    instanceName: string;
    number: string;
    text: string;
    linkPreview?: boolean;
  }) {
    return this.request('POST', `/message/sendText/${args.instanceName}`, {
      number: args.number,
      text: args.text,
      ...(args.linkPreview != null ? { linkPreview: args.linkPreview } : {}),
    });
  }

  /** Ubicación NATIVA de WhatsApp (pin tocable en el chat, abre el mapa). */
  async sendLocation(args: {
    instanceName: string;
    number: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }) {
    return this.request('POST', `/message/sendLocation/${args.instanceName}`, {
      number: args.number,
      latitude: args.latitude,
      longitude: args.longitude,
      name: args.name ?? '',
      address: args.address ?? '',
    });
  }
}
