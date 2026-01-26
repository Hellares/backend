import { Injectable } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { EmpresaPermissionsDto } from '../../empresa/dto';

/**
 * Servicio centralizado para el cálculo de permisos
 *
 * Este servicio es la ÚNICA fuente de verdad para la lógica de permisos.
 * Tanto PermissionsGuard como EmpresaService deben usar este servicio.
 *
 * IMPORTANTE: Si necesitas agregar/modificar permisos, hazlo AQUÍ.
 */
@Injectable()
export class PermissionsService {
  /**
   * Calcula permisos basados en los roles del usuario
   *
   * @param roles - Array de roles del usuario en la empresa
   * @returns Objeto con todos los permisos como propiedades boolean
   */
  calculatePermissions(roles: Rol[]): EmpresaPermissionsDto {
    const isSuperAdmin = roles.includes(Rol.SUPER_ADMIN);
    const isEmpresaAdmin = roles.includes(Rol.EMPRESA_ADMIN);
    const isSedeAdmin = roles.includes(Rol.SEDE_ADMIN);
    const isCajero = roles.includes(Rol.CAJERO);
    const isVendedor = roles.includes(Rol.VENDEDOR);
    const isTecnico = roles.includes(Rol.TECNICO);
    const isContador = roles.includes(Rol.CONTADOR);

    return {
      // ==================== USUARIOS ====================
      // Ver usuarios: Administradores y contadores
      canViewUsers:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isContador,

      // Gestión de usuarios: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageUsers: isSuperAdmin || isEmpresaAdmin,

      // ==================== PRODUCTOS ====================
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

      // ==================== SERVICIOS ====================
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

      // ==================== CLIENTES ====================
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

      // ==================== SEDES ====================
      // Gestión de sedes: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageSedes: isSuperAdmin || isEmpresaAdmin,

      // ==================== REPORTES ====================
      // Ver reportes: Todos excepto roles muy básicos
      canViewReports:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isContador ||
        isCajero,

      // ==================== FACTURAS ====================
      // Gestión de comprobantes/facturas: Admins, CAJERO, CONTADOR
      canManageInvoices:
        isSuperAdmin ||
        isEmpresaAdmin ||
        isSedeAdmin ||
        isCajero ||
        isContador,

      // ==================== ÓRDENES DE SERVICIO ====================
      // Gestión de órdenes de servicio: Admins, SEDE_ADMIN, TECNICO
      canManageOrders:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isTecnico,

      // ==================== ESTADÍSTICAS ====================
      // Ver estadísticas: Admins y CONTADOR
      canViewStatistics:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isContador,

      // ==================== CONFIGURACIÓN ====================
      // Gestión de configuración: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManageSettings: isSuperAdmin || isEmpresaAdmin,

      // Gestión de métodos de pago: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canManagePaymentMethods: isSuperAdmin || isEmpresaAdmin,

      // Cambiar plan de suscripción: Solo SUPER_ADMIN y EMPRESA_ADMIN
      canChangePlan: isSuperAdmin || isEmpresaAdmin,

      // ==================== DESCUENTOS ====================
      // Ver políticas de descuento: Administradores
      canViewDiscounts: isSuperAdmin || isEmpresaAdmin || isSedeAdmin,

      // Gestionar políticas de descuento: Solo administradores de empresa
      canManageDiscounts: isSuperAdmin || isEmpresaAdmin,

      // Asignar usuarios y productos a políticas de descuento: Administradores de empresa
      canAssignDiscounts: isSuperAdmin || isEmpresaAdmin,

      // ==================== PROVEEDORES ====================
      // Ver proveedores: Administradores y contador
      canViewProveedores:
        isSuperAdmin || isEmpresaAdmin || isSedeAdmin || isContador,

      // Gestionar proveedores: Solo administradores
      canManageProveedores: isSuperAdmin || isEmpresaAdmin || isSedeAdmin,
    };
  }

  /**
   * Verifica si los roles dados tienen un permiso específico
   *
   * @param roles - Array de roles del usuario
   * @param permission - Nombre del permiso a verificar (ej: 'canManageProducts')
   * @returns true si tiene el permiso, false en caso contrario
   */
  hasPermission(roles: Rol[], permission: string): boolean {
    const permissions = this.calculatePermissions(roles);
    return permissions[permission] === true;
  }

  /**
   * Retorna todos los permisos disponibles en el sistema
   * Útil para documentación o generar interfaces
   */
  getAllAvailablePermissions(): string[] {
    return [
      'canViewUsers',
      'canManageUsers',
      'canViewProducts',
      'canManageProducts',
      'canViewServices',
      'canManageServices',
      'canViewClients',
      'canManageClients',
      'canManageSedes',
      'canViewReports',
      'canManageInvoices',
      'canManageOrders',
      'canViewStatistics',
      'canManageSettings',
      'canManagePaymentMethods',
      'canChangePlan',
      'canViewDiscounts',
      'canManageDiscounts',
      'canAssignDiscounts',
      'canViewProveedores',
      'canManageProveedores',
    ];
  }
}
