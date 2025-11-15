import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    // Usar REDIS_URL si está disponible, si no usar parámetros individuales
    const redisUrl = configService.get('REDIS_URL');

    if (redisUrl) {
      // Usar URL completa de conexión
      this.redis = new Redis(redisUrl);
    } else {
      // Usar parámetros individuales
      this.redis = new Redis({
        host: configService.get('REDIS_HOST', 'localhost'),
        port: configService.get('REDIS_PORT', 6379),
        password: configService.get('REDIS_PASSWORD') || undefined,
        db: configService.get('REDIS_DB', 0),
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
    }

    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });
  }

  /**
   * Obtener valor por clave
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      console.error('Redis GET error:', error);
      return null;
    }
  }

  /**
   * Establecer valor con TTL
   */
  async setex(key: string, ttl: number, value: string): Promise<boolean> {
    try {
      const result = await this.redis.setex(key, ttl, value);
      return result === 'OK';
    } catch (error) {
      console.error('Redis SETEX error:', error);
      return false;
    }
  }

  /**
   * Establecer valor sin TTL
   */
  async set(key: string, value: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, value);
      return result === 'OK';
    } catch (error) {
      console.error('Redis SET error:', error);
      return false;
    }
  }

  /**
   * Eliminar clave
   */
  async del(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch (error) {
      console.error('Redis DEL error:', error);
      return 0;
    }
  }

  /**
   * Verificar si existe clave
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS error:', error);
      return false;
    }
  }

  /**
   * Establecer expiración a clave existente
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      console.error('Redis EXPIRE error:', error);
      return false;
    }
  }

  /**
   * Obtener TTL de clave
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      console.error('Redis TTL error:', error);
      return -1;
    }
  }

  /**
   * Añadir a set
   */
  async sadd(key: string, member: string): Promise<number> {
    try {
      return await this.redis.sadd(key, member);
    } catch (error) {
      console.error('Redis SADD error:', error);
      return 0;
    }
  }

  /**
   * Remover de set
   */
  async srem(key: string, member: string): Promise<number> {
    try {
      return await this.redis.srem(key, member);
    } catch (error) {
      console.error('Redis SREM error:', error);
      return 0;
    }
  }

  /**
   * Obtener todos los miembros de un set
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch (error) {
      console.error('Redis SMEMBERS error:', error);
      return [];
    }
  }

  /**
   * Verificar si miembro existe en set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(key, member);
      return result === 1;
    } catch (error) {
      console.error('Redis SISMEMBER error:', error);
      return false;
    }
  }

  /**
   * Incrementar contador
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      console.error('Redis INCR error:', error);
      return 0;
    }
  }

  /**
   * Decrementar contador
   */
  async decr(key: string): Promise<number> {
    try {
      return await this.redis.decr(key);
    } catch (error) {
      console.error('Redis DECR error:', error);
      return 0;
    }
  }

  /**
   * Obtener claves con patrón (sin eliminar)
   */
  async getKeysByPattern(pattern: string): Promise<string[]> {
    try {
      const keys = await this.redis.keys(pattern);
      return keys;
    } catch (error) {
      console.error('Redis KEYS PATTERN error:', error);
      return [];
    }
  }

  /**
   * Limpiar claves con patrón
   */
  async flushByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      return await this.redis.del(...keys);
    } catch (error) {
      console.error('Redis FLUSH PATTERN error:', error);
      return 0;
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis PING error:', error);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}