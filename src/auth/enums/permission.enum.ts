/**
 * Enum de permisos disponibles en el sistema
 * Usa este enum en lugar de strings para evitar errores de tipeo
 *
 * Uso:
 * @RequiresPermission(Permission.MANAGE_PRODUCTS)
 */
export enum Permission {
  // Usuarios
  MANAGE_USERS = 'canManageUsers',

  // Productos
  VIEW_PRODUCTS = 'canViewProducts',      // Ver catálogo de productos
  MANAGE_PRODUCTS = 'canManageProducts',  // Crear, editar, eliminar productos

  // Servicios
  VIEW_SERVICES = 'canViewServices',      // Ver catálogo de servicios
  MANAGE_SERVICES = 'canManageServices',  // Crear, editar, eliminar servicios

  // Clientes
  VIEW_CLIENTS = 'canViewClients',        // Ver lista de clientes
  MANAGE_CLIENTS = 'canManageClients',    // Crear, editar, eliminar clientes

  // Otros permisos
  MANAGE_SEDES = 'canManageSedes',
  VIEW_REPORTS = 'canViewReports',
  MANAGE_INVOICES = 'canManageInvoices',
  MANAGE_ORDERS = 'canManageOrders',
  VIEW_STATISTICS = 'canViewStatistics',
  MANAGE_SETTINGS = 'canManageSettings',
  MANAGE_PAYMENT_METHODS = 'canManagePaymentMethods',
  CHANGE_PLAN = 'canChangePlan',
}
