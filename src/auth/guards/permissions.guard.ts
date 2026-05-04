import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../services/permissions.service';
import { Rol } from '@prisma/client';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Guard que valida permisos del usuario en la empresa actual
 *
 * Uso:
 * @UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
 * @RequiresPermission('canManageProducts')
 * @Post()
 * create() { ... }
 *
 * IMPORTANTE: Debe usarse DESPUÉS de TenantAuthGuard, que cachea los roles
 * en request._tenantRoles para evitar queries duplicadas.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Leer el permiso requerido del decorador
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no hay permiso requerido, permitir acceso
    if (!requiredPermission) {
      return true;
    }

    // 2. Obtener usuario y empresa del request
    const request = context.switchToHttp().getRequest();
    const user = request.user as any;
    const tenantId = request.headers['x-tenant-id'] as string;

    if (!user || !tenantId) {
      throw new ForbiddenException('Usuario o empresa no especificados');
    }

    // 3. SUPER_ADMIN tiene todos los permisos
    if (user.rolGlobal === Rol.SUPER_ADMIN) {
      return true;
    }

    // 4. Reutilizar roles cacheados por TenantAuthGuard (0 queries)
    //    Fallback a query directa si no están disponibles
    let roles: Rol[];

    if (request._tenantRoles && request._tenantRoles.length > 0) {
      roles = request._tenantRoles as Rol[];
    } else {
      // Fallback: query directa (solo si TenantAuthGuard no se ejecutó antes)
      const userRoles = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          usuarioId: user.sub || user.id,
          empresaId: tenantId,
          isActive: true,
          deletedAt: null,
        },
        select: { rol: true },
      });

      if (!userRoles.length) {
        throw new ForbiddenException('No tienes acceso a esta empresa');
      }

      roles = userRoles.map(r => r.rol);
    }

    // 4.5. Cargar overrides granulares desde UsuarioSedeRol. Si el usuario
    //      tiene `puedeAbrirCaja` o `puedeCerrarCaja` en CUALQUIER sede de
    //      la empresa, le otorgamos el permiso. La validación de que la
    //      sede específica esté autorizada queda en el service del endpoint.
    const sedeRoles = await this.prisma.usuarioSedeRol.findMany({
      where: {
        usuarioId: user.sub || user.id,
        sede: { empresaId: tenantId, deletedAt: null },
        isActive: true,
        deletedAt: null,
      },
      select: { puedeAbrirCaja: true, puedeCerrarCaja: true },
    });

    const overrides = {
      puedeAbrirCaja: sedeRoles.some((s) => s.puedeAbrirCaja),
      puedeCerrarCaja: sedeRoles.some((s) => s.puedeCerrarCaja),
    };

    // 5. Calcular permisos combinando roles + overrides individuales.
    const permissions = this.permissionsService.calculatePermissions(
      roles,
      overrides,
    );

    // 6. Verificar si tiene el permiso requerido
    if (!permissions[requiredPermission]) {
      throw new ForbiddenException(
        `No tienes permiso para realizar esta acción (requiere: ${requiredPermission})`,
      );
    }

    return true;
  }
}
