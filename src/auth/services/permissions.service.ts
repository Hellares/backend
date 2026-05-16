import { Injectable } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { EmpresaPermissionsDto } from '../../empresa/dto';
import { GranularPermissionId } from './granular-permissions.catalog';

/**
 * Servicio centralizado para el cálculo de permisos
 *
 * Este servicio es la ÚNICA fuente de verdad para la lógica de permisos.
 * Tanto PermissionsGuard como EmpresaService deben usar este servicio.
 *
 * IMPORTANTE: Si necesitas agregar/modificar permisos, hazlo AQUÍ.
 */
/**
 * Overrides individuales por sede que pueden ampliar los permisos
 * derivados del rol. Hoy soporta caja granular (`puedeAbrirCaja` /
 * `puedeCerrarCaja`). Si en alguna sede de la empresa el usuario tiene
 * el flag, el permiso se concede a nivel global de empresa (el guard a
 * nivel sede específica se valida en el endpoint si aplica).
 */
export interface PermissionsOverrides {
  puedeAbrirCaja?: boolean;
  puedeCerrarCaja?: boolean;
}

@Injectable()
export class PermissionsService {
  /**
   * Calcula permisos basados en los roles del usuario y opcionalmente
   * en overrides individuales (flags de `UsuarioSedeRol`).
   *
   * @param roles - Array de roles del usuario en la empresa
   * @param overrides - Flags opcionales que amplían los permisos por rol
   *                    (típicamente derivados de `UsuarioSedeRol`).
   * @returns Objeto con todos los permisos como propiedades boolean
   */
  calculatePermissions(
    roles: Rol[],
    overrides?: PermissionsOverrides,
  ): EmpresaPermissionsDto {
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

    // Overrides granulares: se aplican como OR sobre el rol base. Si el
    // usuario tiene el flag en cualquier sede de la empresa, le otorgamos
    // el permiso correspondiente.
    const puedeAbrirCajaPorFlag = overrides?.puedeAbrirCaja === true;
    const puedeCerrarCajaPorFlag = overrides?.puedeCerrarCaja === true;

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

      // ==================== CAJA ====================
      canViewCaja:
        isAnyAdmin || isCajero || isContador ||
        puedeAbrirCajaPorFlag || puedeCerrarCajaPorFlag,
      canManageCaja:
        isAnyAdmin || isCajero ||
        puedeAbrirCajaPorFlag || puedeCerrarCajaPorFlag,
      // Granulares: permiten abrir y/o cerrar por separado vía flag.
      canAbrirCaja:
        isAnyAdmin || isCajero || puedeAbrirCajaPorFlag,
      canCerrarCaja:
        isAnyAdmin || isCajero || puedeCerrarCajaPorFlag,

      // ==================== RRHH - EMPLEADOS ====================
      canViewEmpleados:
        isAnyAdmin || isContador || isViewer,
      canManageEmpleados: isAdmin,

      // ==================== RRHH - ASISTENCIA ====================
      canViewAsistencia:
        isAnyAdmin || isContador || isViewer,
      canManageAsistencia: isAnyAdmin,

      // ==================== RRHH - PLANILLA ====================
      canViewPlanilla:
        isAnyAdmin || isContador,
      canManagePlanilla: isAdmin,

      // ==================== RRHH - APROBACIONES ====================
      canApproveIncidencias: isAnyAdmin,
      canApprovePlanilla: isAdmin,

      // ==================== GASTOS RECURRENTES ====================
      canViewGastosRecurrentes:
        isAnyAdmin || isContador || isViewer,
      canManageGastosRecurrentes:
        isAnyAdmin || isContador,
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
   * Verifica un permiso GRANULAR (catálogo `granular-permissions.catalog`)
   * combinando 3 fuentes en orden:
   *  1. El array `permisos` del `UsuarioSedeRol` (consolidado entre sedes).
   *  2. Compat con flags legacy: `caja.abrir` ↔ `puedeAbrirCaja`,
   *     `caja.cerrar` ↔ `puedeCerrarCaja`. Mientras la migración a
   *     strings esté en progreso, los flags siguen siendo verdad.
   *  3. SUPER_ADMIN/EMPRESA_ADMIN tienen TODOS los granulares.
   *
   * Pensado para usarse desde endpoints que necesiten autorización
   * por usuario (ej. `if (!hasGranular(...)) throw 403`).
   */
  hasGranularPermission(
    permisos: readonly string[],
    permId: string,
    options?: {
      roles?: Rol[];
      overrides?: PermissionsOverrides;
    },
  ): boolean {
    // Admin global tiene todos los granulares.
    if (
      options?.roles?.includes(Rol.SUPER_ADMIN) ||
      options?.roles?.includes(Rol.EMPRESA_ADMIN)
    ) {
      return true;
    }
    // Compat con flags legacy.
    if (
      permId === GranularPermissionId.CAJA_ABRIR &&
      options?.overrides?.puedeAbrirCaja
    ) {
      return true;
    }
    if (
      permId === GranularPermissionId.CAJA_CERRAR &&
      options?.overrides?.puedeCerrarCaja
    ) {
      return true;
    }
    // Catálogo: presencia explícita en el array.
    return permisos.includes(permId);
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
      'canViewCaja',
      'canManageCaja',
      'canAbrirCaja',
      'canCerrarCaja',
      'canViewEmpleados',
      'canManageEmpleados',
      'canViewAsistencia',
      'canManageAsistencia',
      'canViewPlanilla',
      'canManagePlanilla',
      'canApproveIncidencias',
      'canApprovePlanilla',
      'canViewGastosRecurrentes',
      'canManageGastosRecurrentes',
    ];
  }
}
