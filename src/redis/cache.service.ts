import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Servicio de cache genérico para reducir queries a la base de datos
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTTL = 1800; // 30 minutos por defecto

  constructor(private readonly redis: RedisService) {}

  /**
   * Obtener o calcular un valor con cache
   * @param key Clave del cache
   * @param fetcher Función para obtener el dato si no está en cache
   * @param ttl Tiempo de vida en segundos (default: 30 minutos)
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = this.defaultTTL,
  ): Promise<T> {
    try {
      // Intentar obtener del cache
      const cached = await this.redis.get(key);

      if (cached) {
        this.logger.debug(`✅ Cache HIT: ${key}`);
        return JSON.parse(cached) as T;
      }

      this.logger.debug(`❌ Cache MISS: ${key}`);

      // Si no está en cache, ejecutar fetcher
      const data = await fetcher();

      // Guardar en cache
      await this.redis.setex(key, ttl, JSON.stringify(data));

      return data;
    } catch (error) {
      this.logger.error(`Error in cache getOrSet for key ${key}:`, error);
      // Si hay error con Redis, ejecutar fetcher directamente
      return fetcher();
    }
  }

  /**
   * Invalidar cache por clave
   */
  async invalidate(key: string): Promise<void> {
    try {
      const deletedCount = await this.redis.del(key);
      if (deletedCount > 0) {
        this.logger.debug(`🗑️ Cache invalidated: ${key}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache for key ${key}:`, error);
    }
  }

  /**
   * Invalidar cache por patrón
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const deletedCount = await this.redis.flushByPattern(pattern);
      if (deletedCount > 0) {
        this.logger.debug(`🗑️ Cache invalidated (${deletedCount} keys): ${pattern}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating cache pattern ${pattern}:`, error);
    }
  }

  /**
   * Generar clave de cache para estadísticas de empresa
   */
  getEmpresaStatsKey(empresaId: string): string {
    return `stats:empresa:${empresaId}`;
  }

  /**
   * Generar clave de cache para dashboard de empresa
   */
  getEmpresaDashboardKey(empresaId: string, userId: string): string {
    return `dashboard:empresa:${empresaId}:user:${userId}`;
  }

  /**
   * Generar clave de cache para lista de productos
   * Usa hash de filtros normalizado (keys ordenadas + undefined omitidos)
   * para que `{page:1, search:'a'}` y `{search:'a', page:1}` produzcan la
   * misma clave — sin esto el hit rate dependería del orden de propiedades
   * en el DTO, que cambia entre clientes y versiones.
   */
  getProductosListKey(empresaId: string, filtros: any): string {
    const hash = this.simpleHash(this.stableStringify(filtros));
    return `productos:empresa:${empresaId}:${hash}`;
  }

  /**
   * Invalidar todos los caches de listas de productos de una empresa
   * Se llama cuando se crea/actualiza/elimina un producto
   */
  async invalidateProductosLists(empresaId: string): Promise<void> {
    await this.invalidatePattern(`productos:empresa:${empresaId}:*`);
    this.logger.log(`🗑️ Invalidados todos los caches de productos para empresa ${empresaId}`);
  }

  /**
   * Invalidar todos los caches relacionados a una empresa
   */
  async invalidateEmpresa(empresaId: string): Promise<void> {
    await Promise.all([
      this.invalidatePattern(`*:empresa:${empresaId}*`),
      this.invalidate(`tenant:id:${empresaId}`),
    ]);
  }

  /**
   * Invalidar cache de tenant por subdominio
   */
  async invalidateTenant(empresaId: string, subdominio?: string): Promise<void> {
    const promises: Promise<void>[] = [
      this.invalidate(`tenant:id:${empresaId}`),
    ];
    if (subdominio) {
      promises.push(this.invalidate(`tenant:subdomain:${subdominio}`));
    }
    await Promise.all(promises);
  }

  /**
   * Generar clave de cache para contexto de empresa
   */
  getEmpresaContextKey(empresaId: string, userId: string): string {
    return `context:empresa:${empresaId}:user:${userId}`;
  }

  /**
   * Generar clave de cache para lista de empresas de usuario
   */
  getUserEmpresasKey(userId: string): string {
    return `user_empresas:${userId}`;
  }

  /**
   * Invalidar caché de acceso tenant para un usuario en una empresa.
   *
   * Invalida ambas claves dependientes:
   *  - `tenant_access:${userId}:${empresaId}` — chequeo rápido de acceso.
   *  - `context:empresa:${empresaId}:user:${userId}` — contexto completo
   *    (permisos, accesos rápidos, flags caja). Sin esto, cambios en
   *    `UsuarioSedeRol` no se reflejan hasta que expira el TTL (10 min).
   */
  async invalidateTenantAccess(userId: string, empresaId: string): Promise<void> {
    await Promise.all([
      this.invalidate(`tenant_access:${userId}:${empresaId}`),
      this.invalidate(this.getEmpresaContextKey(empresaId, userId)),
    ]);
  }

  /**
   * Invalidar caché de acceso tenant para todos los usuarios de una empresa.
   * Borra los acceso rápidos `tenant_access:*` y los contextos completos
   * `context:empresa:${empresaId}:user:*`.
   */
  async invalidateAllTenantAccess(empresaId: string): Promise<void> {
    await Promise.all([
      this.invalidatePattern(`tenant_access:*:${empresaId}`),
      this.invalidatePattern(`context:empresa:${empresaId}:user:*`),
    ]);
  }

  /**
   * Serializa un objeto en forma estable: keys ordenadas alfabéticamente y
   * propiedades `undefined` omitidas. Necesario porque `JSON.stringify` usa
   * el orden de inserción, lo que rompe hits de cache cuando el DTO llega
   * con propiedades en distinto orden.
   */
  private stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.stableStringify(v)).join(',') + ']';
    }
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + this.stableStringify(value[k]))
        .join(',') +
      '}'
    );
  }

  /**
   * Generar hash simple para cache keys
   * No necesita ser criptográficamente seguro, solo único
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
