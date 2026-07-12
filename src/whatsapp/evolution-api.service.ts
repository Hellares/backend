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
      events: ['CONNECTION_UPDATE'],
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

  /** QR para vincular: { base64, code, pairingCode }. */
  async connect(instanceName: string): Promise<any> {
    return this.request('GET', `/instance/connect/${instanceName}`);
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
   * agendado). `media` acepta URL pública — Evolution la descarga.
   */
  async sendImage(args: {
    instanceName: string;
    number: string;
    mediaUrl: string;
    caption: string;
    fileName?: string;
  }) {
    return this.request('POST', `/message/sendMedia/${args.instanceName}`, {
      number: args.number,
      mediatype: 'image',
      mimetype: 'image/jpeg',
      media: args.mediaUrl,
      fileName: args.fileName ?? 'ticket-envio.jpg',
      caption: args.caption,
    });
  }

  /** Mensaje de texto simple. */
  async sendText(args: {
    instanceName: string;
    number: string;
    text: string;
  }) {
    return this.request('POST', `/message/sendText/${args.instanceName}`, {
      number: args.number,
      text: args.text,
    });
  }
}
