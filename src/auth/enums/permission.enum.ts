/**
 * Enum de permisos disponibles en el sistema
 * Usa este enum en lugar de strings para evitar errores de tipeo
 *
 * Uso:
 * @RequiresPermission(Permission.MANAGE_PRODUCTS)
 */
export enum Permission {
  // Usuarios
  VIEW_USERS = 'canViewUsers',            // Ver lista de usuarios/trabajadores
  MANAGE_USERS = 'canManageUsers',        // Crear, editar, eliminar usuarios

  // Productos
  VIEW_PRODUCTS = 'canViewProducts',      // Ver catálogo de productos
  MANAGE_PRODUCTS = 'canManageProducts',  // Crear, editar, eliminar productos

  // Servicios
  VIEW_SERVICES = 'canViewServices',      // Ver catálogo de servicios
  MANAGE_SERVICES = 'canManageServices',  // Crear, editar, eliminar servicios

  // Clientes
  VIEW_CLIENTS = 'canViewClients',        // Ver lista de clientes
  MANAGE_CLIENTS = 'canManageClients',    // Crear, editar, eliminar clientes

  // Descuentos
  VIEW_DISCOUNTS = 'canViewDiscounts',           // Ver políticas de descuento
  MANAGE_DISCOUNTS = 'canManageDiscounts',       // Crear, editar, eliminar políticas
  ASSIGN_DISCOUNTS = 'canAssignDiscounts',       // Asignar descuentos a usuarios
  APPROVE_FAMILY = 'canApproveFamily',           // Aprobar familiares de trabajadores
  VIEW_DISCOUNT_REPORTS = 'canViewDiscountReports', // Ver reportes de descuentos

  // Proveedores
  VIEW_PROVEEDORES = 'canViewProveedores',       // Ver lista de proveedores
  MANAGE_PROVEEDORES = 'canManageProveedores',   // Crear, editar, eliminar proveedores

  // Cotizaciones
  VIEW_COTIZACIONES = 'canViewCotizaciones',       // Ver lista de cotizaciones
  MANAGE_COTIZACIONES = 'canManageCotizaciones',   // Crear, editar, eliminar cotizaciones

  // Ventas
  VIEW_VENTAS = 'canViewVentas',                         // Ver lista de ventas
  MANAGE_VENTAS = 'canManageVentas',                     // Crear, editar, confirmar, anular ventas

  // Devoluciones
  VIEW_DEVOLUCIONES = 'canViewDevoluciones',                 // Ver lista de devoluciones
  MANAGE_DEVOLUCIONES = 'canManageDevoluciones',             // Crear, aprobar, procesar devoluciones

  // Compras
  VIEW_COMPRAS = 'canViewCompras',                       // Ver órdenes de compra, compras y lotes
  MANAGE_COMPRAS = 'canManageCompras',                   // Crear, editar, eliminar compras
  APPROVE_ORDENES_COMPRA = 'canApproveOrdenesCompra',    // Aprobar órdenes de compra

  // Caja
  VIEW_CAJA = 'canViewCaja',
  MANAGE_CAJA = 'canManageCaja',

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
