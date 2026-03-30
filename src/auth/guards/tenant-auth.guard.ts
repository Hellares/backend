import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';

interface TenantAccessCache {
  roles: string[];     // Roles del usuario en la empresa (EmpresaUsuarioRol)
  isClient: boolean;   // Si tiene acceso como cliente (EmpresaPersona)
}

@Injectable()
export class TenantAuthGuard implements CanActivate {
  private static readonly CACHE_TTL = 300; // 5 minutos

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id: string; personaId: string; rolGlobal?: string };
    const empresa = request.currentEmpresa;

    if (!user) throw new UnauthorizedException('Usuario no autenticado');
    if (!empresa) throw new UnauthorizedException('Empresa no resuelta');

    // SUPER_ADMIN tiene acceso total
    if (user.rolGlobal === 'SUPER_ADMIN') {
      return true;
    }

    // Obtener roles y acceso con caché Redis
    const cacheKey = `tenant_access:${user.id}:${empresa.id}`;

    const accessData = await this.cache.getOrSet<TenantAccessCache>(
      cacheKey,
      async () => {
        // Obtener todos los roles del usuario en la empresa
        const userRoles = await this.prisma.empresaUsuarioRol.findMany({
          where: { usuarioId: user.id, empresaId: empresa.id, isActive: true, deletedAt: null },
          select: { rol: true },
        });

        if (userRoles.length > 0) {
          return { roles: userRoles.map(r => r.rol), isClient: false };
        }

        // Verificar si es cliente
        const esCliente = await this.prisma.empresaPersona.findFirst({
          where: { personaId: user.personaId, empresaId: empresa.id, isActive: true, deletedAt: null },
          select: { id: true },
        });

        if (esCliente) {
          return { roles: [], isClient: true };
        }

        return { roles: [], isClient: false };
      },
      TenantAuthGuard.CACHE_TTL,
    );

    if (accessData.roles.length > 0 || accessData.isClient) {
      // Inyectar roles en el request para que PermissionsGuard los reutilice
      (request as any)._tenantRoles = accessData.roles;

      // Verificar estado de suscripción (solo bloqueo duro para SUSPENDIDA)
      if (empresa.estadoSuscripcion === 'SUSPENDIDA') {
        throw new ForbiddenException(
          'Esta empresa ha sido suspendida por el administrador. Contacte soporte para más información.',
        );
      }

      return true;
    }

    throw new UnauthorizedException('No tienes acceso a esta empresa');
  }
}
