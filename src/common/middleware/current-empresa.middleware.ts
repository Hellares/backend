import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';

/**
 * Middleware para resolver la empresa actual desde el header X-Tenant-ID
 * Este middleware es requerido por el TenantAuthGuard
 * Usa Redis cache para evitar queries a la BD en cada request
 */
@Injectable()
export class CurrentEmpresaMiddleware implements NestMiddleware {
  private static readonly CACHE_TTL = 300; // 5 minutos

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenantId = req.get('x-tenant-id');

    if (tenantId) {
      const cacheKey = `tenant:id:${tenantId}`;

      const empresa = await this.cache.getOrSet(
        cacheKey,
        async () => {
          const result = await this.prisma.empresa.findUnique({
            where: { id: tenantId },
            select: {
              id: true,
              subdominio: true,
              nombre: true,
              estadoSuscripcion: true,
            },
          });
          return result;
        },
        CurrentEmpresaMiddleware.CACHE_TTL,
      );

      if (empresa) {
        req.currentEmpresa = empresa;
      }
    }

    next();
  }
}
