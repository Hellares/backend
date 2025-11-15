import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateSessionData {
  userId: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  lastAccessAt: Date;
  isActive: boolean;
  expiresAt: Date;
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Crear una nueva sesión
   */
  async createSession(data: CreateSessionData, expiresIn: number = 7 * 24 * 60 * 60 * 1000): Promise<string> {
    const sessionId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn);
    const ttlSeconds = Math.floor(expiresIn / 1000);

    const sessionInfo: SessionInfo = {
      sessionId,
      userId: data.userId,
      deviceInfo: data.deviceInfo || 'Unknown Device',
      ipAddress: data.ipAddress || 'Unknown IP',
      userAgent: data.userAgent || 'Unknown',
      createdAt: now,
      lastAccessAt: now,
      isActive: true,
      expiresAt,
    };

    // Guardar sesión en Redis con TTL
    const sessionKey = `session:${sessionId}`;
    const sessionData = JSON.stringify(sessionInfo);

    await this.redisService.setex(sessionKey, ttlSeconds, sessionData);

    // Agregar sessionId al set de sesiones del usuario
    const userSessionsKey = `user_sessions:${data.userId}`;
    await this.redisService.sadd(userSessionsKey, sessionId);

    // Establecer TTL al set de sesiones del usuario
    await this.redisService.expire(userSessionsKey, ttlSeconds);

    return sessionId;
  }

  /**
   * Obtener información de una sesión
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const sessionKey = `session:${sessionId}`;
    const sessionData = await this.redisService.get(sessionKey);

    if (!sessionData) {
      return null;
    }

    try {
      const session: SessionInfo = JSON.parse(sessionData);

      // Convertir fechas de string a Date objects
      session.createdAt = new Date(session.createdAt);
      session.lastAccessAt = new Date(session.lastAccessAt);
      session.expiresAt = new Date(session.expiresAt);

      // Verificar si ha expirado
      if (session.expiresAt < new Date()) {
        await this.removeSession(sessionId);
        return null;
      }

      // Actualizar último acceso
      session.lastAccessAt = new Date();
      await this.redisService.setex(sessionKey,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        JSON.stringify(session)
      );

      return session;
    } catch (error) {
      console.error('Error parsing session data:', error);
      return null;
    }
  }

  /**
   * Obtener todas las sesiones activas de un usuario
   */
  async getUserSessions(userId: string): Promise<SessionInfo[]> {
    const userSessionsKey = `user_sessions:${userId}`;
    const sessionIds = await this.redisService.smembers(userSessionsKey);
    const sessions: SessionInfo[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.isActive) {
        sessions.push(session);
      } else {
        // Limpiar sesión inválida del set
        await this.redisService.srem(userSessionsKey, sessionId);
      }
    }

    return sessions.sort((a, b) => b.lastAccessAt.getTime() - a.lastAccessAt.getTime());
  }

  /**
   * Revocar una sesión específica
   */
  async revokeSession(sessionId: string, userId?: string): Promise<boolean> {
    const sessionKey = `session:${sessionId}`;
    const sessionData = await this.redisService.get(sessionKey);

    if (!sessionData) {
      return false;
    }

    try {
      const session: SessionInfo = JSON.parse(sessionData);

      // Convertir fechas de string a Date objects
      session.createdAt = new Date(session.createdAt);
      session.lastAccessAt = new Date(session.lastAccessAt);
      session.expiresAt = new Date(session.expiresAt);

      // Verificar que el usuario tenga permiso para revocar esta sesión
      if (userId && session.userId !== userId) {
        return false;
      }

      // Marcar como inactiva
      session.isActive = false;
      await this.redisService.set(sessionKey, JSON.stringify(session));

      // Agregar a blacklist con TTL igual al tiempo restante de expiración
      const blacklistKey = `blacklist:${sessionId}`;
      const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);

      if (ttl > 0) {
        await this.redisService.setex(blacklistKey, ttl, 'true');
      }

      return true;
    } catch (error) {
      console.error('Error revoking session:', error);
      return false;
    }
  }

  /**
   * Revocar todas las sesiones de un usuario excepto la actual
   */
  async revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    const userSessionsKey = `user_sessions:${userId}`;
    const sessionIds = await this.redisService.smembers(userSessionsKey);
    let revokedCount = 0;

    for (const sessionId of sessionIds) {
      if (sessionId !== currentSessionId) {
        if (await this.revokeSession(sessionId, userId)) {
          revokedCount++;
        }
      }
    }

    return revokedCount;
  }

  /**
   * Revocar todas las sesiones de un usuario
   */
  async revokeAllUserSessions(userId: string): Promise<number> {
    const userSessionsKey = `user_sessions:${userId}`;
    const sessionIds = await this.redisService.smembers(userSessionsKey);
    let revokedCount = 0;

    for (const sessionId of sessionIds) {
      if (await this.revokeSession(sessionId, userId)) {
        revokedCount++;
      }
    }

    return revokedCount;
  }

  /**
   * Eliminar sesión (limpieza interna)
   */
  private async removeSession(sessionId: string): Promise<void> {
    const sessionKey = `session:${sessionId}`;
    const sessionData = await this.redisService.get(sessionKey);

    if (sessionData) {
      try {
        const session: SessionInfo = JSON.parse(sessionData);
        const userSessionsKey = `user_sessions:${session.userId}`;

        await this.redisService.del(sessionKey);
        await this.redisService.srem(userSessionsKey, sessionId);
      } catch (error) {
        console.error('Error removing session:', error);
      }
    }
  }

  /**
   * Limpiar sesiones expiradas (ejecutar periódicamente)
   */
  async cleanupExpiredSessions(): Promise<number> {
    // Redis maneja la limpieza automáticamente con TTL
    // Solo necesitamos limpiar los sets de sesiones de usuarios
    const pattern = 'user_sessions:*';
    const keys = await this.redisService.flushByPattern(pattern);
    return keys;
  }

  /**
   * Verificar si una sesión está en blacklist (para logout real)
   */
  async isSessionBlacklisted(sessionId: string): Promise<boolean> {
    const blacklistKey = `blacklist:${sessionId}`;
    return await this.redisService.exists(blacklistKey);
  }
}