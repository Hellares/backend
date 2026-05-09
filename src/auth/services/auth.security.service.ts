import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { AppLoggerService } from '../../common/logger/logger.service';

export interface FailedAttempt {
  attempts: number;
  lastAttempt: Date;
  isLocked: boolean;
  lockUntil?: Date;
}

@Injectable()
export class AuthSecurityService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(AuthSecurityService.name);
  }

  async recordFailedAttempt(identifier: string, type: 'login' | 'password_reset' = 'login'): Promise<FailedAttempt> {
    const key = `failed_attempts:${type}:${identifier}`;
    const maxAttempts = this.configService.get('MAX_LOGIN_ATTEMPTS', 5);
    const lockoutMinutes = this.configService.get('LOCKOUT_DURATION_MINUTES', 15);
    const lockoutDurationMs = lockoutMinutes * 60 * 1000;
    const lockoutDurationSec = lockoutMinutes * 60;

    // INCR atómico: evita race condition de get→parseInt→++→setex que
    // bajo concurrencia podía contar 5 intentos simultáneos como 1.
    // Solo seteamos TTL en el primer intento (cuando attempts === 1).
    const attempts = await this.redisService.incr(key);
    if (attempts === 1) {
      await this.redisService.expire(key, lockoutDurationSec);
    }

    const now = new Date();
    const isLocked = attempts >= maxAttempts;
    const lockUntil = isLocked ? new Date(now.getTime() + lockoutDurationMs) : undefined;

    // Si está bloqueado, guardar timestamp de desbloqueo
    if (isLocked) {
      const lockKey = `lock:${type}:${identifier}`;
      await this.redisService.setex(lockKey, lockoutDurationMs, lockUntil!.toISOString());
    }

    this.logger.warn(
      `Failed ${type} attempt: ${attempts}/${maxAttempts} (locked: ${isLocked}) for ${identifier}`,
      {
        identifier,
        attempts,
        maxAttempts,
        isLocked,
        type,
      }
    );

    return {
      attempts,
      lastAttempt: now,
      isLocked,
      lockUntil,
    };
  }

  async clearFailedAttempts(identifier: string, type: 'login' | 'password_reset' = 'login'): Promise<void> {
    const key = `failed_attempts:${type}:${identifier}`;
    const lockKey = `lock:${type}:${identifier}`;

    await Promise.all([
      this.redisService.del(key),
      this.redisService.del(lockKey),
    ]);
  }

  async isLockedOut(identifier: string, type: 'login' | 'password_reset' = 'login'): Promise<{
    isLocked: boolean;
    remainingTime?: number;
  }> {
    const lockKey = `lock:${type}:${identifier}`;
    const lockData = await this.redisService.get(lockKey);

    if (!lockData) {
      return { isLocked: false };
    }

    const lockUntil = new Date(lockData);
    const now = new Date();
    const remainingTime = lockUntil.getTime() - now.getTime();

    if (remainingTime <= 0) {
      // El lockout expiró, limpiar
      await this.clearFailedAttempts(identifier, type);
      return { isLocked: false };
    }

    return {
      isLocked: true,
      remainingTime: Math.ceil(remainingTime / 1000), // Retornar en segundos
    };
  }

  getClientInfo(request: any): {
    ip: string;
    userAgent: string;
    device: string;
    platform: string;
  } {
    const forwarded = request.headers?.['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : request.connection?.remoteAddress || request.ip || '127.0.0.1';

    const userAgent = request.headers?.['user-agent'] || 'Unknown User Agent';
    const device = this.extractDevice(userAgent);
    const platform = this.extractPlatform(userAgent);

    return {
      ip: ip.replace('::ffff:', ''), // Limpiar IPv6 mapped IPv4
      userAgent,
      device,
      platform,
    };
  }

  private extractDevice(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'Mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'Tablet';
    } else if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return 'Bot';
    }

    return 'Desktop';
  }

  private extractPlatform(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    if (ua.includes('windows')) return 'Windows';
    if (ua.includes('mac')) return 'macOS';
    if (ua.includes('linux')) return 'Linux';
    if (ua.includes('android')) return 'Android';
    if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) return 'iOS';

    return 'Unknown';
  }
}