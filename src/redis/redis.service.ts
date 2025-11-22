import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis'; // ← Import correcto (soluciona TS2702)
import { AppLoggerService } from '../common/logger/logger.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger: AppLoggerService;
  private pingInterval?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(RedisService.name);
    const redisUrl = this.configService.get<string>('REDIS_URL');

    const redisOptions: RedisOptions = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: this.configService.get<number>('REDIS_DB', 0),
      lazyConnect: true,

      // Configuración de timeouts
      connectTimeout: 10000, // 10s para conectar
      commandTimeout: 5000,  // 5s para comandos (evita comandos colgados)

      // Keep-alive para mantener la conexión
      keepAlive: 30000, // Envía ping cada 30s para mantener viva la conexión

      // Estrategia de reconexión mejorada
      maxRetriesPerRequest: 5,
      retryStrategy: (times) => {
        if (times > 10) {
          this.logger.error('Max Redis retry attempts reached, giving up');
          return null; // Detener después de 10 intentos
        }
        const delay = Math.min(times * 100, 5000);
        this.logger.warn('Redis reconnecting', { delay, attempt: times });
        return delay;
      },

      // Reintentar solo en errores de conexión, no en errores de comandos
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Reconectar en modo READONLY
        }
        return false; // No reconectar en otros errores (solo en close/end)
      },

      // Verificar que Redis esté listo antes de enviar comandos
      enableReadyCheck: true,

      // Encolar comandos cuando no hay conexión (útil durante reconexiones)
      enableOfflineQueue: true,
    };

    this.redis = redisUrl
      ? new Redis(redisUrl, redisOptions)
      : new Redis(redisOptions);

    // Eventos amigables y que NO matan el proceso
    this.redis.on('connect', () => {
      this.logger.success('Redis connected successfully', {
        host: redisOptions.host,
        port: redisOptions.port,
        db: redisOptions.db,
      });
    });

    this.redis.on('ready', () => {
      this.logger.info('Redis client ready to accept commands');
    });

    this.redis.on('error', (err) => {
      this.logger.error(
        'Redis Client Error (servidor sigue vivo)',
        err.stack,
        {
          error: err.message,
          code: (err as any).code,
        }
      );
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed unexpectedly - will attempt reconnection');
    });

    this.redis.on('reconnecting', (ms) => {
      this.logger.warn('Redis reconnecting attempt', {
        delayMs: ms,
        timestamp: new Date().toISOString(),
      });
    });

    this.redis.on('end', () => {
      this.logger.error('Redis connection ended permanently - max retries reached or connection terminated');
    });

    // Forzar conexión al iniciar (opcional pero recomendado)
    this.connect();
  }

  private async connect() {
    try {
      await this.redis.connect();
      // Iniciar monitor de ping en desarrollo
      if (this.configService.get('NODE_ENV') === 'development') {
        this.startPingMonitor();
      }
    } catch (err) {
      this.logger.error('Failed initial Redis connection (will retry automatically)', err);
    }
  }

  /**
   * Monitor de ping periódico (solo en desarrollo)
   */
  private startPingMonitor() {
    // Ping cada 30 segundos
    this.pingInterval = setInterval(async () => {
      try {
        const start = Date.now();
        const result = await this.redis.ping();
        const latency = Date.now() - start;

        if (result === 'PONG') {
          this.logger.debug('Redis online', {
            latency: `${latency}ms`,
            status: 'connected',
          });
        }
      } catch (error) {
        this.logger.error('Redis ping failed', error.stack, {
          error: error.message,
        });
      }
    }, 30000); // 30 segundos

    this.logger.debug('Redis ping monitor started (every 30s)');
  }

  // ====================== TUS MÉTODOS ORIGINALES (todos conservados) ======================

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Redis GET error (${key}):`, error.message);
      return null;
    }
  }

  async setex(key: string, ttl: number, value: string): Promise<boolean> {
    try {
      const result = await this.redis.setex(key, ttl, value);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Redis SETEX error (${key}):`, error.message);
      return false;
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, value);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Redis SET error (${key}):`, error.message);
      return false;
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Redis DEL error (${key}):`, error.message);
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis EXISTS error (${key}):`, error.message);
      return false;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis EXPIRE error (${key}):`, error.message);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Redis TTL error (${key}):`, error.message);
      return -1;
    }
  }

  async sadd(key: string, member: string): Promise<number> {
    try {
      return await this.redis.sadd(key, member);
    } catch (error) {
      this.logger.error(`Redis SADD error (${key}):`, error.message);
      return 0;
    }
  }

  async srem(key: string, member: string): Promise<number> {
    try {
      return await this.redis.srem(key, member);
    } catch (error) {
      this.logger.error(`Redis SREM error (${key}):`, error.message);
      return 0;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch (error) {
      this.logger.error(`Redis SMEMBERS error (${key}):`, error.message);
      return [];
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(key, member);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis SISMEMBER error (${key}):`, error.message);
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Redis INCR error (${key}):`, error.message);
      return 0;
    }
  }

  async decr(key: string): Promise<number> {
    try {
      return await this.redis.decr(key);
    } catch (error) {
      this.logger.error(`Redis DECR error (${key}):`, error.message);
      return 0;
    }
  }

  async getKeysByPattern(pattern: string): Promise<string[]> {
    try {
      const keys: string[] = [];
      let cursor = '0';

      do {
        const [nextCursor, batch] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100, // Procesa 100 claves por iteración
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      return keys;
    } catch (error) {
      this.logger.error(`Redis SCAN PATTERN error (${pattern}):`, error.message);
      return [];
    }
  }

  async flushByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.getKeysByPattern(pattern); // Usa SCAN internamente
      if (keys.length === 0) return 0;
      return await this.redis.del(...keys);
    } catch (error) {
      this.logger.error(`Redis FLUSH PATTERN error (${pattern}):`, error.message);
      return 0;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis PING failed:', error.message);
      return false;
    }
  }

  // Cierre limpio
  async onModuleDestroy() {
    try {
      // Detener monitor de ping
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.logger.debug('Redis ping monitor stopped');
      }

      await this.redis.quit();
      this.logger.log('Redis connection closed gracefully');
    } catch (error) {
      this.logger.error('Error closing Redis connection:', error);
    }
  }

  // Opcional: acceso directo al cliente
  getClient(): Redis {
    return this.redis;
  }
}