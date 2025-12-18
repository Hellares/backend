import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Middleware para resolver la empresa actual desde el header X-Tenant-ID
 * Este middleware es requerido por el TenantAuthGuard
 */
@Injectable()
export class CurrentEmpresaMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Leer el header x-tenant-id (case-insensitive)
    const tenantId = req.get('x-tenant-id');

    if (tenantId) {
      // Buscar la empresa en la base de datos
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          subdominio: true,
          nombre: true,
        },
      });

      // Si la empresa existe, asignarla al request
      if (empresa) {
        req.currentEmpresa = empresa;
      }
    }

    next();
  }
}
