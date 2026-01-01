import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
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

    // 5. Calcular permisos basados en los roles
    const permissions = this.calculatePermissions(
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

  /**
   * Calcula permisos basados en los roles del usuario
   * NOTA: Esta lógica debe estar sincronizada con empresa.service.ts
   */
  private calculatePermissions(roles: Rol[]): Record<string, boolean> {
    const isSuperAdmin = roles.includes(Rol.SUPER_ADMIN);
    const isEmpresaAdmin = roles.includes(Rol.EMPRESA_ADMIN);
    const isSedeAdmin = roles.includes(Rol.SEDE_ADMIN);
    const isCajero = roles.includes(Rol.CAJERO);
    const isVendedor = roles.includes(Rol.VENDEDOR);
    const isTecnico = roles.includes(Rol.TECNICO);
    const isContador = roles.includes(Rol.CONTADOR);

    return {
      // Gestión de usuarios: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageUsers: isSuperAdmin || isEmpresaAdmin,

      // PRODUCTOS - Separado en VIEW y MANAGE
      // Ver productos: Todos los roles que trabajan con productos
      canViewProducts:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isVendedor ||
        isCajero ||
        isTecnico,

      // Gestionar productos: Solo administradores
      canManageProducts: isSuperAdmin || isEmpresaAdmin || isSedeAdmin,

      // SERVICIOS - Separado en VIEW y MANAGE
      // Ver servicios: Todos los roles que trabajan con servicios
      canViewServices:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isTecnico ||
        isCajero,

      // Gestionar servicios: Admins y TECNICO
      canManageServices:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isTecnico,

      // CLIENTES - Separado en VIEW y MANAGE
      // Ver clientes: Todos los roles que interactúan con clientes
      canViewClients:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isVendedor ||
        isCajero ||
        isTecnico,

      // Gestionar clientes: Admins, VENDEDOR y CAJERO
      canManageClients:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isVendedor ||
        isCajero,

      // Gestión de sedes: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageSedes: isSuperAdmin || isEmpresaAdmin,

      // Ver reportes: Todos excepto roles muy básicos
      canViewReports:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isContador ||
        isCajero,

      // Gestión de comprobantes/facturas: Admins, CAJERO, CONTADOR
      canManageInvoices:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isCajero ||
        isContador,

      // Gestión de órdenes de servicio: Admins, SEDE_ADMIN, TECNICO
      canManageOrders:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isTecnico,

      // Ver estadísticas: Admins y CONTADOR
      canViewStatistics:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isContador,

      // Gestión de configuración: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageSettings: isSuperAdmin || isEmpresaAdmin,

      // Gestión de métodos de pago: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManagePaymentMethods: isSuperAdmin || isEmpresaAdmin,

      // Cambiar plan de suscripción: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canChangePlan: isSuperAdmin || isEmpresaAdmin,

      // DESCUENTOS - Separado en VIEW, MANAGE y ASSIGN
      // Ver políticas de descuento: Administradores
      canViewDiscounts: isSuperAdmin || isEmpresaAdmin || isSedeAdmin,

      // Gestionar políticas de descuento: Solo administradores de empresa
      canManageDiscounts: isSuperAdmin || isEmpresaAdmin,

      // Asignar usuarios y productos a políticas de descuento: Administradores de empresa
      canAssignDiscounts: isSuperAdmin || isEmpresaAdmin,
    };
  }
}
