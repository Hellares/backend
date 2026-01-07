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

    // 4. Obtener roles del usuario en la empresa desde la BD
    const userRoles = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        usuarioId: user.sub || user.id,
        empresaId: tenantId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!userRoles.length) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    // 5. Calcular permisos basados en los roles usando el servicio centralizado
    const permissions = this.permissionsService.calculatePermissions(
      userRoles.map((r) => r.rol),
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
