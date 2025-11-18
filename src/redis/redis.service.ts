// import { Injectable, OnModuleDestroy } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import Redis from 'ioredis';

// @Injectable()
// export class RedisService implements OnModuleDestroy {
//   private readonly redis: Redis;

//   constructor(private readonly configService: ConfigService) {
//     // Usar REDIS_URL si está disponible, si no usar parámetros individuales
//     const redisUrl = configService.get('REDIS_URL');

//     if (redisUrl) {
//       // Usar URL completa de conexión
//       this.redis = new Redis(redisUrl);
//     } else {
//       // Usar parámetros individuales
//       this.redis = new Redis({
//         host: configService.get('REDIS_HOST', 'localhost'),
//         port: configService.get('REDIS_PORT', 6379),
//         password: configService.get('REDIS_PASSWORD') || undefined,
//         db: configService.get('REDIS_DB', 0),
//         lazyConnect: true,
//         maxRetriesPerRequest: 3,
//       });
//     }

//     this.redis.on('error', (err) => {
//       console.error('Redis connection error:', err);
//     });

//     this.redis.on('connect', () => {
//       console.log('✅ Redis connected successfully');
//     });
//   }

//   /**
//    * Obtener valor por clave
//    */
//   async get(key: string): Promise<string | null> {
//     try {
//       return await this.redis.get(key);
//     } catch (error) {
//       console.error('Redis GET error:', error);
//       return null;
//     }
//   }

//   /**
//    * Establecer valor con TTL
//    */
//   async setex(key: string, ttl: number, value: string): Promise<boolean> {
//     try {
//       const result = await this.redis.setex(key, ttl, value);
//       return result === 'OK';
//     } catch (error) {
//       console.error('Redis SETEX error:', error);
//       return false;
//     }
//   }

//   /**
//    * Establecer valor sin TTL
//    */
//   async set(key: string, value: string): Promise<boolean> {
//     try {
//       const result = await this.redis.set(key, value);
//       return result === 'OK';
//     } catch (error) {
//       console.error('Redis SET error:', error);
//       return false;
//     }
//   }

//   /**
//    * Eliminar clave
//    */
//   async del(key: string): Promise<number> {
//     try {
//       return await this.redis.del(key);
//     } catch (error) {
//       console.error('Redis DEL error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Verificar si existe clave
//    */
//   async exists(key: string): Promise<boolean> {
//     try {
//       const result = await this.redis.exists(key);
//       return result === 1;
//     } catch (error) {
//       console.error('Redis EXISTS error:', error);
//       return false;
//     }
//   }

//   /**
//    * Establecer expiración a clave existente
//    */
//   async expire(key: string, ttl: number): Promise<boolean> {
//     try {
//       const result = await this.redis.expire(key, ttl);
//       return result === 1;
//     } catch (error) {
//       console.error('Redis EXPIRE error:', error);
//       return false;
//     }
//   }

//   /**
//    * Obtener TTL de clave
//    */
//   async ttl(key: string): Promise<number> {
//     try {
//       return await this.redis.ttl(key);
//     } catch (error) {
//       console.error('Redis TTL error:', error);
//       return -1;
//     }
//   }

//   /**
//    * Añadir a set
//    */
//   async sadd(key: string, member: string): Promise<number> {
//     try {
//       return await this.redis.sadd(key, member);
//     } catch (error) {
//       console.error('Redis SADD error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Remover de set
//    */
//   async srem(key: string, member: string): Promise<number> {
//     try {
//       return await this.redis.srem(key, member);
//     } catch (error) {
//       console.error('Redis SREM error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Obtener todos los miembros de un set
//    */
//   async smembers(key: string): Promise<string[]> {
//     try {
//       return await this.redis.smembers(key);
//     } catch (error) {
//       console.error('Redis SMEMBERS error:', error);
//       return [];
//     }
//   }

//   /**
//    * Verificar si miembro existe en set
//    */
//   async sismember(key: string, member: string): Promise<boolean> {
//     try {
//       const result = await this.redis.sismember(key, member);
//       return result === 1;
//     } catch (error) {
//       console.error('Redis SISMEMBER error:', error);
//       return false;
//     }
//   }

//   /**
//    * Incrementar contador
//    */
//   async incr(key: string): Promise<number> {
//     try {
//       return await this.redis.incr(key);
//     } catch (error) {
//       console.error('Redis INCR error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Decrementar contador
//    */
//   async decr(key: string): Promise<number> {
//     try {
//       return await this.redis.decr(key);
//     } catch (error) {
//       console.error('Redis DECR error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Obtener claves con patrón (sin eliminar)
//    */
//   async getKeysByPattern(pattern: string): Promise<string[]> {
//     try {
//       const keys = await this.redis.keys(pattern);
//       return keys;
//     } catch (error) {
//       console.error('Redis KEYS PATTERN error:', error);
//       return [];
//     }
//   }

//   /**
//    * Limpiar claves con patrón
//    */
//   async flushByPattern(pattern: string): Promise<number> {
//     try {
//       const keys = await this.redis.keys(pattern);
//       if (keys.length === 0) {
//         return 0;
//       }
//       return await this.redis.del(...keys);
//     } catch (error) {
//       console.error('Redis FLUSH PATTERN error:', error);
//       return 0;
//     }
//   }

//   /**
//    * Health check
//    */
//   async ping(): Promise<boolean> {
//     try {
//       const result = await this.redis.ping();
//       return result === 'PONG';
//     } catch (error) {
//       console.error('Redis PING error:', error);
//       return false;
//     }
//   }

//   async onModuleDestroy() {
//     await this.redis.quit();
//   }
// }

// src/redis/redis.service.ts
import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis'; // ← Import correcto (soluciona TS2702)

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');

    const redisOptions: RedisOptions = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: this.configService.get<number>('REDIS_DB', 0),
      lazyConnect: true,
      maxRetriesPerRequest: 5,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 5000);
        this.logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times + 1})`);
        return delay;
      },
      reconnectOnError: () => true, // Reintenta en cualquier error de conexión
    };

    this.redis = redisUrl
      ? new Redis(redisUrl, redisOptions)
      : new Redis(redisOptions);

    // Eventos amigables y que NO matan el proceso
    this.redis.on('connect', () => this.logger.log('✅ Redis connected successfully'));
    this.redis.on('ready', () => this.logger.log('Redis client ready'));
    this.redis.on('error', (err) => this.logger.error('Redis Client Error (servidor sigue vivo):', err.message));
    this.redis.on('close', () => this.logger.warn('Redis connection closed'));
    this.redis.on('reconnecting', (ms) => this.logger.warn(`Redis reconnecting in ${ms?.delay ?? '?'}ms...`));
    this.redis.on('end', () => this.logger.error('Redis connection ended permanently'));

    // Forzar conexión al iniciar (opcional pero recomendado)
    this.connect();
  }

  private async connect() {
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.error('Failed initial Redis connection (will retry automatically)', err);
    }
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
      this.logger.error(`Redis INCR error (${key}:`, error.message);
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
      return await this.redis.keys(pattern);
    } catch (error) {
      this.logger.error(`Redis KEYS PATTERN error (${pattern}):`, error.message);
      return [];
    }
  }

  async flushByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(pattern);
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