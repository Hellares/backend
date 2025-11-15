import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    // Extraer tenant del subdominio o header
    const host = req.get('host');
    const tenantHeader = req.get('x-tenant-id');

    if (tenantHeader) {
      req.tenant = { id: tenantHeader, subdominio: undefined, nombre: undefined };
    } else if (host) {
      const subdomain = host.split('.')[0];
      req.tenant = { id: '', subdominio: subdomain, nombre: undefined };
    }

    next();
  }
}