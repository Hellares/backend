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

  /**
   * Registra un intento fallido. Si se pasa `ip`, mantiene un segundo
   * contador `failed_attempts:ip:${ip}:${identifier}` con un umbral
   * más permisivo (10 vs 5 por credencial).
   *
   * Lockout dispara si CUALQUIERA de los dos contadores supera su
   * umbral. Esto mitiga:
   *  - Brute force distribuido: muchas IPs probando 1 password contra
   *    1 cuenta — cae por el contador por credencial.
   *  - Ataque de bloqueo (DoS): 1 atacante intenta bloquear cuentas
   *    ajenas con 5 intentos fallidos — el contador por IP+credencial
   *    también lo cuenta, pero el legítimo usando OTRA IP no se ve
   *    afectado por esta segunda métrica.
   */
  async recordFailedAttempt(
    identifier: string,
    type: 'login' | 'password_reset' = 'login',
    ip?: string,
  ): Promise<FailedAttempt> {
    const credKey = `failed_attempts:${type}:${identifier}`;
    const maxAttemptsCred = this.configService.get('MAX_LOGIN_ATTEMPTS', 5);
    const maxAttemptsIp = this.configService.get('MAX_LOGIN_ATTEMPTS_IP', 10);
    const lockoutMinutes = this.configService.get('LOCKOUT_DURATION_MINUTES', 15);
    const lockoutDurationMs = lockoutMinutes * 60 * 1000;
    const lockoutDurationSec = lockoutMinutes * 60;

    // Contador por credencial (atómico).
    const credAttempts = await this.redisService.incr(credKey);
    if (credAttempts === 1) {
      await this.redisService.expire(credKey, lockoutDurationSec);
    }

    // Contador opcional por IP+credencial (atómico).
    let ipAttempts = 0;
    if (ip) {
      const ipKey = `failed_attempts:${type}:ip:${ip}:${identifier}`;
      ipAttempts = await this.redisService.incr(ipKey);
      if (ipAttempts === 1) {
        await this.redisService.expire(ipKey, lockoutDurationSec);
      }
    }

    const credLocked = credAttempts >= maxAttemptsCred;
    const ipLocked = ip ? ipAttempts >= maxAttemptsIp : false;
    const isLocked = credLocked || ipLocked;
    const now = new Date();
    const lockUntil = isLocked ? new Date(now.getTime() + lockoutDurationMs) : undefined;

    if (credLocked) {
      const lockKey = `lock:${type}:${identifier}`;
      await this.redisService.setex(lockKey, lockoutDurationMs, lockUntil!.toISOString());
    }
    if (ipLocked && ip) {
      const lockKey = `lock:${type}:ip:${ip}:${identifier}`;
      await this.redisService.setex(lockKey, lockoutDurationMs, lockUntil!.toISOString());
    }

    this.logger.warn(
      `Failed ${type} attempt: cred=${credAttempts}/${maxAttemptsCred} ip=${ipAttempts}/${maxAttemptsIp} (locked: ${isLocked}) for ${identifier}${ip ? ' from ' + ip : ''}`,
      {
        identifier,
        ip,
        credAttempts,
        ipAttempts,
        isLocked,
        type,
      }
    );

    return {
      attempts: Math.max(credAttempts, ipAttempts),
      lastAttempt: now,
      isLocked,
      lockUntil,
    };
  }

  async clearFailedAttempts(
    identifier: string,
    type: 'login' | 'password_reset' = 'login',
    ip?: string,
  ): Promise<void> {
    const credKey = `failed_attempts:${type}:${identifier}`;
    const credLockKey = `lock:${type}:${identifier}`;

    const promises: Promise<any>[] = [
      this.redisService.del(credKey),
      this.redisService.del(credLockKey),
    ];

    if (ip) {
      const ipKey = `failed_attempts:${type}:ip:${ip}:${identifier}`;
      const ipLockKey = `lock:${type}:ip:${ip}:${identifier}`;
      promises.push(
        this.redisService.del(ipKey),
        this.redisService.del(ipLockKey),
      );
    }

    await Promise.all(promises);
  }

  /**
   * Devuelve true si CUALQUIERA de los locks (por credencial o por
   * IP+credencial) está activo. Si ambos están activos, devuelve el
   * que tenga más tiempo restante.
   */
  async isLockedOut(
    identifier: string,
    type: 'login' | 'password_reset' = 'login',
    ip?: string,
  ): Promise<{
    isLocked: boolean;
    remainingTime?: number;
  }> {
    const credLockKey = `lock:${type}:${identifier}`;
    const ipLockKey = ip ? `lock:${type}:ip:${ip}:${identifier}` : null;

    const [credLockData, ipLockData] = await Promise.all([
      this.redisService.get(credLockKey),
      ipLockKey ? this.redisService.get(ipLockKey) : Promise.resolve(null),
    ]);

    const now = new Date();
    let maxRemaining = 0;
    let anyActive = false;

    for (const data of [credLockData, ipLockData]) {
      if (!data) continue;
      const lockUntil = new Date(data);
      const remaining = lockUntil.getTime() - now.getTime();
      if (remaining > 0) {
        anyActive = true;
        if (remaining > maxRemaining) maxRemaining = remaining;
      }
    }

    if (!anyActive) {
      // Ambos locks expiraron o no existen — limpiar contadores
      await this.clearFailedAttempts(identifier, type, ip);
      return { isLocked: false };
    }

    return {
      isLocked: true,
      remainingTime: Math.ceil(maxRemaining / 1000),
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