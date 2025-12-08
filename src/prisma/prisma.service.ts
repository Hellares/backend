import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private queryCount = 0;
  private slowQueryThreshold = 2000; // 2 segundos
  private pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
    });

    this.pool = pool;

    // Monitorear queries lentas
    this.$on('query' as never, (e: any) => {
      this.queryCount++;

      if (e.duration > this.slowQueryThreshold) {
        this.logger.warn(`🐌 Slow query detected (${e.duration}ms): ${e.query.substring(0, 100)}...`);
      }

      // Log cada 100 queries para monitorear actividad
      if (this.queryCount % 100 === 0) {
        this.logger.debug(`📊 Queries executed: ${this.queryCount}`);
      }
    });

    // Monitorear errores de queries
    this.$on('error' as never, (e: any) => {
      this.logger.error(`❌ Prisma Error: ${e.message}`, e.stack);
    });

    // Monitorear warnings
    this.$on('warn' as never, (e: any) => {
      this.logger.warn(`⚠️ Prisma Warning: ${e.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Database connected successfully');

      // Warm up connection pool con una query simple
      await this.$queryRaw`SELECT 1`;
      this.logger.log('✅ Connection pool warmed up');

      // Iniciar monitoreo de pool cada 5 minutos
      this.startPoolMonitoring();
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      await this.pool.end();
      this.logger.log('👋 Database disconnected successfully');
    } catch (error) {
      this.logger.error('❌ Error disconnecting from database', error);
    }
  }

  /**
   * Monitorear el estado del connection pool
   */
  private startPoolMonitoring() {
    setInterval(async () => {
      try {
        // Verificar si $metrics está disponible (Prisma 5.x con métricas habilitadas)
        if ('$metrics' in this && typeof (this as any).$metrics?.json === 'function') {
          const metrics = await (this as any).$metrics.json();

          const activeConnections = metrics.counters?.find(
            (c: any) => c.key === 'prisma_client_queries_active'
          )?.value || 0;

          const totalQueries = metrics.counters?.find(
            (c: any) => c.key === 'prisma_client_queries_total'
          )?.value || 0;

          this.logger.debug(
            `📊 Pool Stats - Active: ${activeConnections}, Total: ${totalQueries}, Rate: ${this.queryCount} queries`
          );

          // Alerta si hay muchas conexiones activas
          if (activeConnections > 15) {
            this.logger.warn(
              `⚠️ High connection usage: ${activeConnections}/20 active connections`
            );
          }
        } else {
          // Si no hay $metrics, solo mostrar contador de queries
          this.logger.debug(
            `📊 Pool Stats - Query rate: ${this.queryCount} queries in last 5 minutes`
          );
        }

        // Reset contador
        this.queryCount = 0;
      } catch (error) {
        // Ignorar errores de metrics silenciosamente
        this.logger.debug('Pool monitoring: metrics not available');
      }
    }, 300000); // Cada 5 minutos
  }

  /**
   * Helper para ejecutar queries con timeout manual
   */
  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = 10000,
    errorMessage: string = 'Query timeout'
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }
}