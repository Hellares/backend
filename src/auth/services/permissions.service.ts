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
    const isLectura = roles.includes(Rol.LECTURA);
    const isOperador = roles.includes(Rol.OPERADOR);

    // Helpers de nivel — simplifican la asignación y evitan errores al agregar roles
    const isAdmin = isSuperAdmin || isEmpresaAdmin;
    const isAnyAdmin = isAdmin || isSedeAdmin;
    const isOperativo = isVendedor || isCajero || isTecnico || isOperador;
    const isViewer = isLectura; // solo lectura, nunca MANAGE

    return {
      // ==================== USUARIOS ====================
      canViewUsers:
        isAnyAdmin || isContador || isViewer,
      canManageUsers: isAdmin,

      // ==================== PRODUCTOS ====================
      canViewProducts:
        isAnyAdmin || isOperativo || isContador || isViewer,
      canManageProducts: isAnyAdmin,

      // ==================== SERVICIOS ====================
      canViewServices:
        isAnyAdmin || isTecnico || isCajero || isVendedor || isContador || isViewer,
      canManageServices:
        isAnyAdmin || isTecnico,

      // ==================== CLIENTES ====================
      canViewClients:
        isAnyAdmin || isOperativo || isContador || isViewer,
      canManageClients:
        isAnyAdmin || isVendedor || isCajero || isOperador,

      // ==================== SEDES ====================
      canManageSedes: isAdmin,

      // ==================== REPORTES ====================
      canViewReports:
        isAnyAdmin || isContador || isCajero || isViewer,

      // ==================== FACTURAS ====================
      canManageInvoices:
        isAnyAdmin || isCajero || isContador,

      // ==================== ÓRDENES DE SERVICIO ====================
      canManageOrders:
        isAnyAdmin || isTecnico,

      // ==================== ESTADÍSTICAS ====================
      canViewStatistics:
        isAnyAdmin || isContador || isViewer,

      // ==================== CONFIGURACIÓN ====================
      canManageSettings: isAdmin,
      canManagePaymentMethods: isAdmin,
      canChangePlan: isAdmin,

      // ==================== DESCUENTOS ====================
      canViewDiscounts: isAnyAdmin || isContador || isViewer,
      canManageDiscounts: isAdmin,
      canAssignDiscounts: isAdmin,

      // ==================== COTIZACIONES ====================
      canViewCotizaciones:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      canManageCotizaciones:
        isAnyAdmin || isVendedor,

      // ==================== VENTAS ====================
      canViewVentas:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      canManageVentas:
        isAnyAdmin || isVendedor || isCajero,

      // ==================== DEVOLUCIONES ====================
      canViewDevoluciones:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      canManageDevoluciones: isAnyAdmin,

      // ==================== PROVEEDORES ====================
      canViewProveedores:
        isAnyAdmin || isContador || isOperador || isViewer,
      canManageProveedores: isAnyAdmin,

      // ==================== COMPRAS ====================
      canViewCompras:
        isAnyAdmin || isContador || isOperador || isViewer,
      canManageCompras: isAnyAdmin,
      canApproveOrdenesCompra: isAdmin,

      // ==================== REPORTES DE INCIDENCIA ====================
      canViewReportesIncidencia:
        isAnyAdmin || isContador || isTecnico || isViewer,
      canManageReportesIncidencia:
        isAnyAdmin || isTecnico,
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
      'canViewCotizaciones',
      'canManageCotizaciones',
      'canViewVentas',
      'canManageVentas',
      'canViewDevoluciones',
      'canManageDevoluciones',
      'canViewProveedores',
      'canManageProveedores',
      'canViewCompras',
      'canManageCompras',
      'canApproveOrdenesCompra',
      'canViewReportesIncidencia',
      'canManageReportesIncidencia',
    ];
  }
}
