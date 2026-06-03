import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from './firebase-admin.service';
import { TipoNotificacion } from '@prisma/client';

@Injectable()
export class NotificacionService {
  private readonly logger = new Logger(NotificacionService.name);

  constructor(
    private prisma: PrismaService,
    private firebaseAdmin: FirebaseAdminService,
  ) {}

  // ─── Gestión de tokens FCM ───

  async registrarDispositivo(
    usuarioId: string,
    fcmToken: string,
    platform: string,
    deviceInfo?: string,
  ) {
    // Validar formato básico del token FCM
    if (!fcmToken || fcmToken.length < 100) {
      this.logger.warn(`Token FCM inválido (longitud: ${fcmToken?.length})`);
      return null;
    }

    // Desactivar tokens antiguos de otros usuarios con el mismo token
    await this.prisma.dispositivoNotificacion.updateMany({
      where: { fcmToken, usuarioId: { not: usuarioId } },
      data: { isActive: false },
    });

    // Upsert: crear o reactivar
    const dispositivo = await this.prisma.dispositivoNotificacion.upsert({
      where: {
        usuarioId_fcmToken: { usuarioId, fcmToken },
      },
      update: {
        isActive: true,
        platform,
        deviceInfo,
        lastUsedAt: new Date(),
      },
      create: {
        usuarioId,
        fcmToken,
        platform,
        deviceInfo,
      },
    });

    // Limpieza para evitar acumulación de tokens (FCM rota el token en cada
    // reinstalación/restore → filas muertas). Conserva por usuario solo los 5
    // tokens usados más recientemente (el recién registrado siempre queda) y
    // elimina el resto, sin importar si están activos o no.
    const conservar = await this.prisma.dispositivoNotificacion.findMany({
      where: { usuarioId },
      orderBy: { lastUsedAt: 'desc' },
      take: 5,
      select: { id: true },
    });
    const idsConservar = conservar.map((d) => d.id);
    await this.prisma.dispositivoNotificacion.deleteMany({
      where: { usuarioId, id: { notIn: idsConservar } },
    });

    return dispositivo;
  }

  async desactivarDispositivo(usuarioId: string, fcmToken: string) {
    await this.prisma.dispositivoNotificacion.updateMany({
      where: { usuarioId, fcmToken },
      data: { isActive: false },
    });
  }

  // ─── Preferencias de notificación ───

  async getPreferencias(usuarioId: string) {
    const prefs = await this.prisma.preferenciaNotificacion.findMany({
      where: { usuarioId },
    });

    // Retornar todas las opciones con su estado (habilitado por defecto)
    const allTypes = Object.values(TipoNotificacion);
    return allTypes.map((tipo) => {
      const pref = prefs.find((p) => p.tipo === tipo);
      return {
        tipo,
        habilitado: pref?.habilitado ?? true,
      };
    });
  }

  async updatePreferencia(
    usuarioId: string,
    tipo: TipoNotificacion,
    habilitado: boolean,
  ) {
    return this.prisma.preferenciaNotificacion.upsert({
      where: { usuarioId_tipo: { usuarioId, tipo } },
      update: { habilitado },
      create: { usuarioId, tipo, habilitado },
    });
  }

  // ─── Envío de notificaciones ───

  /**
   * Enviar notificación push a un usuario (respeta preferencias)
   */
  async enviarAUsuario(
    usuarioId: string,
    titulo: string,
    cuerpo: string,
    options?: {
      tipo?: TipoNotificacion | string;
      data?: Record<string, string>;
      empresaId?: string;
      guardar?: boolean;
      respetarPreferencias?: boolean;
    },
  ) {
    const {
      tipo = TipoNotificacion.SISTEMA,
      data,
      empresaId,
      guardar = true,
      respetarPreferencias = true,
    } = options ?? {};

    // Mapear string a enum si es necesario
    const tipoEnum = this.resolverTipoEnum(tipo);

    // Verificar preferencias del usuario
    if (respetarPreferencias) {
      const pref = await this.prisma.preferenciaNotificacion.findUnique({
        where: { usuarioId_tipo: { usuarioId, tipo: tipoEnum } },
      });
      if (pref && !pref.habilitado) {
        this.logger.debug(`Notificación ${tipoEnum} silenciada para usuario ${usuarioId}`);
        return;
      }
    }

    // Obtener nombre de la empresa para el título del push
    let tituloConEmpresa = titulo;
    if (empresaId) {
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true },
      });
      if (empresa) {
        tituloConEmpresa = `${empresa.nombre} - ${titulo}`;
      }
    }

    // Guardar en BD (con título original, sin prefijo de empresa)
    if (guardar) {
      await this.prisma.notificacion.create({
        data: {
          usuarioId,
          empresaId,
          titulo,
          cuerpo,
          tipo: tipoEnum,
          data: data ?? undefined,
        },
      });
    }

    // Obtener tokens activos del usuario
    const dispositivos = await this.prisma.dispositivoNotificacion.findMany({
      where: { usuarioId, isActive: true },
      select: { fcmToken: true },
    });

    if (dispositivos.length === 0) return;

    const tokens = dispositivos.map((d) => d.fcmToken);

    try {
      const failedTokens = await this.firebaseAdmin.sendToDevices(
        tokens,
        tituloConEmpresa,
        cuerpo,
        { ...(data ?? {}), tipo: tipoEnum },
      );

      // Desactivar tokens fallidos
      if (failedTokens.length > 0) {
        this.logger.warn(`${failedTokens.length} tokens inválidos desactivados para usuario ${usuarioId}`);
        await this.prisma.dispositivoNotificacion.updateMany({
          where: { fcmToken: { in: failedTokens } },
          data: { isActive: false },
        });
      }
    } catch (error: any) {
      this.logger.error(`Error enviando push a usuario ${usuarioId}: ${error?.message}`);
    }
  }

  /**
   * Enviar notificación a múltiples usuarios en batch
   */
  async enviarAUsuarios(
    usuarioIds: string[],
    titulo: string,
    cuerpo: string,
    options?: {
      tipo?: TipoNotificacion | string;
      data?: Record<string, string>;
      empresaId?: string;
    },
  ) {
    if (usuarioIds.length === 0) return;

    const tipoEnum = this.resolverTipoEnum(options?.tipo);

    // 1. Verificar preferencias en batch
    const prefsBloqueadas = await this.prisma.preferenciaNotificacion.findMany({
      where: {
        usuarioId: { in: usuarioIds },
        tipo: tipoEnum,
        habilitado: false,
      },
      select: { usuarioId: true },
    });
    const bloqueados = new Set(prefsBloqueadas.map((p) => p.usuarioId));
    const idsPermitidos = usuarioIds.filter((id) => !bloqueados.has(id));

    if (idsPermitidos.length === 0) return;

    // 2. Guardar notificaciones en batch
    await this.prisma.notificacion.createMany({
      data: idsPermitidos.map((usuarioId) => ({
        usuarioId,
        empresaId: options?.empresaId,
        titulo,
        cuerpo,
        tipo: tipoEnum,
        data: options?.data ?? undefined,
      })),
    });

    // 3. Obtener todos los tokens en una sola query
    const dispositivos = await this.prisma.dispositivoNotificacion.findMany({
      where: {
        usuarioId: { in: idsPermitidos },
        isActive: true,
      },
      select: { fcmToken: true },
    });

    if (dispositivos.length === 0) return;

    const tokens = dispositivos.map((d) => d.fcmToken);

    // 4. Enviar en batch (Firebase soporta hasta 500 por multicast)
    try {
      const batchSize = 500;
      const allFailedTokens: string[] = [];

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const failed = await this.firebaseAdmin.sendToDevices(
          batch,
          titulo,
          cuerpo,
          { ...(options?.data ?? {}), tipo: tipoEnum },
        );
        allFailedTokens.push(...failed);
      }

      if (allFailedTokens.length > 0) {
        this.logger.warn(`${allFailedTokens.length} tokens inválidos en envío batch`);
        await this.prisma.dispositivoNotificacion.updateMany({
          where: { fcmToken: { in: allFailedTokens } },
          data: { isActive: false },
        });
      }

      this.logger.log(`Push batch enviado: ${tokens.length} dispositivos, ${idsPermitidos.length} usuarios`);
    } catch (error: any) {
      this.logger.error(`Error en envío batch: ${error?.message}`);
    }
  }

  // ─── Lectura de notificaciones ───

  async listarNotificaciones(
    usuarioId: string,
    options?: { empresaId?: string; page?: number; limit?: number },
  ) {
    const { empresaId, page = 1, limit = 20 } = options ?? {};
    const skip = (page - 1) * limit;
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 50);

    const where: any = { usuarioId };
    if (empresaId) where.empresaId = empresaId;

    const [data, total, noLeidas] = await Promise.all([
      this.prisma.notificacion.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.notificacion.count({ where }),
      this.prisma.notificacion.count({ where: { ...where, leida: false } }),
    ]);

    return {
      data,
      total,
      noLeidas,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async marcarLeida(usuarioId: string, notificacionId: string) {
    const result = await this.prisma.notificacion.updateMany({
      where: { id: notificacionId, usuarioId },
      data: { leida: true, leidaEn: new Date() },
    });
    return { updated: result.count };
  }

  async marcarTodasLeidas(usuarioId: string, empresaId?: string) {
    const where: any = { usuarioId, leida: false };
    if (empresaId) where.empresaId = empresaId;

    const result = await this.prisma.notificacion.updateMany({
      where,
      data: { leida: true, leidaEn: new Date() },
    });
    return { updated: result.count };
  }

  async contarNoLeidas(usuarioId: string, empresaId?: string) {
    const where: any = { usuarioId, leida: false };
    if (empresaId) where.empresaId = empresaId;
    return this.prisma.notificacion.count({ where });
  }

  // ─── Cron: Limpieza automática ───

  /**
   * Limpiar notificaciones leídas de más de 90 días
   * y dispositivos inactivos de más de 60 días
   * Se ejecuta diariamente a las 3:00 AM
   */
  @Cron('0 3 * * *')
  async limpiarNotificacionesAntiguas() {
    const hace90Dias = new Date();
    hace90Dias.setDate(hace90Dias.getDate() - 90);

    const hace60Dias = new Date();
    hace60Dias.setDate(hace60Dias.getDate() - 60);

    try {
      // Eliminar notificaciones leídas de más de 90 días
      const deletedNotifs = await this.prisma.notificacion.deleteMany({
        where: {
          leida: true,
          creadoEn: { lt: hace90Dias },
        },
      });

      // Eliminar dispositivos inactivos de más de 60 días
      const deletedDevices = await this.prisma.dispositivoNotificacion.deleteMany({
        where: {
          isActive: false,
          lastUsedAt: { lt: hace60Dias },
        },
      });

      if (deletedNotifs.count > 0 || deletedDevices.count > 0) {
        this.logger.log(
          `Limpieza: ${deletedNotifs.count} notificaciones, ${deletedDevices.count} dispositivos eliminados`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Error en limpieza de notificaciones: ${error?.message}`);
    }
  }

  // ─── Helpers ───

  private resolverTipoEnum(tipo?: TipoNotificacion | string): TipoNotificacion {
    if (!tipo) return TipoNotificacion.SISTEMA;
    if (Object.values(TipoNotificacion).includes(tipo as TipoNotificacion)) {
      return tipo as TipoNotificacion;
    }
    // Mapear strings legacy a enum
    const map: Record<string, TipoNotificacion> = {
      cita: TipoNotificacion.CITA,
      orden: TipoNotificacion.ORDEN_SERVICIO,
      aviso: TipoNotificacion.AVISO_MANTENIMIENTO,
      sistema: TipoNotificacion.SISTEMA,
      promocion: TipoNotificacion.PROMOCION,
      mensaje: TipoNotificacion.MENSAJE,
    };
    return map[tipo.toLowerCase()] ?? TipoNotificacion.SISTEMA;
  }
}
