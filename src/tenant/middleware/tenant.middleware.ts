import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../services/tenant.service';
import { CacheService } from '../../redis/cache.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private static readonly CACHE_TTL = 300; // 5 minutos

  constructor(
    private tenantService: TenantService,
    private cache: CacheService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.get('host');
    const tenantHeader = req.get('x-tenant-id');

    let tenant;

    if (tenantHeader) {
      const cacheKey = `tenant:id:${tenantHeader}`;
      tenant = await this.cache.getOrSet(
        cacheKey,
        () => this.tenantService.findById(tenantHeader),
        TenantMiddleware.CACHE_TTL,
      );
    } else if (host) {
      const subdomain = host.split('.')[0];
      const cacheKey = `tenant:subdomain:${subdomain}`;
      tenant = await this.cache.getOrSet(
        cacheKey,
        () => this.tenantService.findBySubdomain(subdomain),
        TenantMiddleware.CACHE_TTL,
      );
    }

    req.tenant = tenant;
    next();
  }
}