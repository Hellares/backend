import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../services/tenant.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Extraer tenant del subdominio, header o token JWT
    const host = req.get('host');
    const tenantHeader = req.get('x-tenant-id');

    let tenant;

    if (tenantHeader) {
      tenant = await this.tenantService.findById(tenantHeader);
    } else if (host) {
      const subdomain = host.split('.')[0];
      tenant = await this.tenantService.findBySubdomain(subdomain);
    }

    req.tenant = tenant;
    next();
  }
}