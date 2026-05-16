import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para los permisos del usuario en la empresa
 */
export class EmpresaPermissionsDto {
  @ApiProperty({
    description: 'Puede ver la lista de usuarios de la empresa',
    example: true,
  })
  canViewUsers: boolean;

  @ApiProperty({
    description: 'Puede gestionar usuarios de la empresa',
    example: true,
  })
  canManageUsers: boolean;

  @ApiProperty({
    description: 'Puede ver el catálogo de productos',
    example: true,
  })
  canViewProducts: boolean;

  @ApiProperty({
    description: 'Puede gestionar productos (crear, editar, eliminar)',
    example: true,
  })
  canManageProducts: boolean;

  @ApiProperty({
    description: 'Puede ver el catálogo de servicios',
    example: true,
  })
  canViewServices: boolean;

  @ApiProperty({
    description: 'Puede gestionar servicios (crear, editar, eliminar)',
    example: true,
  })
  canManageServices: boolean;

  @ApiProperty({
    description: 'Puede ver políticas de descuento',
    example: true,
  })
  canViewDiscounts: boolean;

  @ApiProperty({
    description: 'Puede gestionar políticas de descuento (crear, editar, eliminar)',
    example: true,
  })
  canManageDiscounts: boolean;

  @ApiProperty({
    description: 'Puede asignar usuarios y productos a políticas de descuento',
    example: true,
  })
  canAssignDiscounts: boolean;

  @ApiProperty({
    description: 'Puede ver la lista de clientes',
    example: true,
  })
  canViewClients: boolean;

  @ApiProperty({
    description: 'Puede gestionar clientes (crear, editar, eliminar)',
    example: true,
  })
  canManageClients: boolean;

  @ApiProperty({
    description: 'Puede ver la lista de cotizaciones',
    example: true,
  })
  canViewCotizaciones: boolean;

  @ApiProperty({
    description: 'Puede gestionar cotizaciones (crear, editar, eliminar)',
    example: true,
  })
  canManageCotizaciones: boolean;

  @ApiProperty({
    description: 'Puede ver la lista de ventas',
    example: true,
  })
  canViewVentas: boolean;

  @ApiProperty({
    description: 'Puede gestionar ventas (crear, confirmar, anular)',
    example: true,
  })
  canManageVentas: boolean;

  @ApiProperty({
    description: 'Puede ver la lista de devoluciones',
    example: true,
  })
  canViewDevoluciones: boolean;

  @ApiProperty({
    description: 'Puede gestionar devoluciones (crear, aprobar, procesar)',
    example: true,
  })
  canManageDevoluciones: boolean;

  @ApiProperty({
    description: 'Puede ver la lista de proveedores',
    example: true,
  })
  canViewProveedores: boolean;

  @ApiProperty({
    description: 'Puede gestionar proveedores (crear, editar, eliminar)',
    example: true,
  })
  canManageProveedores: boolean;

  @ApiProperty({
    description: 'Puede ver órdenes de compra, recepciones y lotes',
    example: true,
  })
  canViewCompras: boolean;

  @ApiProperty({
    description: 'Puede gestionar compras (crear, editar, confirmar)',
    example: true,
  })
  canManageCompras: boolean;

  @ApiProperty({
    description: 'Puede aprobar órdenes de compra',
    example: true,
  })
  canApproveOrdenesCompra: boolean;

  @ApiProperty({
    description: 'Puede gestionar sedes',
    example: true,
  })
  canManageSedes: boolean;

  @ApiProperty({
    description: 'Puede ver reportes',
    example: true,
  })
  canViewReports: boolean;

  @ApiProperty({
    description: 'Puede gestionar comprobantes/facturas',
    example: true,
  })
  canManageInvoices: boolean;

  @ApiProperty({
    description: 'Puede gestionar órdenes de servicio',
    example: true,
  })
  canManageOrders: boolean;

  @ApiProperty({
    description: 'Puede ver estadísticas y métricas',
    example: true,
  })
  canViewStatistics: boolean;

  @ApiProperty({
    description: 'Puede gestionar configuración de la empresa',
    example: true,
  })
  canManageSettings: boolean;

  @ApiProperty({
    description: 'Puede gestionar métodos de pago',
    example: false,
  })
  canManagePaymentMethods: boolean;

  @ApiProperty({
    description: 'Puede cambiar el plan de suscripción',
    example: true,
  })
  canChangePlan: boolean;

  @ApiProperty({
    description: 'Puede ver reportes de incidencia',
    example: true,
  })
  canViewReportesIncidencia: boolean;

  @ApiProperty({
    description: 'Puede gestionar reportes de incidencia (crear, editar, eliminar)',
    example: true,
  })
  canManageReportesIncidencia: boolean;

  @ApiProperty({
    description: 'Puede ver el estado de la caja',
    example: true,
  })
  canViewCaja: boolean;

  @ApiProperty({
    description: 'Puede gestionar caja (abrir, cerrar, registrar movimientos)',
    example: true,
  })
  canManageCaja: boolean;

  @ApiProperty({
    description: 'Puede abrir caja (rol CAJERO/ADMIN o flag UsuarioSedeRol.puedeAbrirCaja)',
    example: true,
  })
  canAbrirCaja: boolean;

  @ApiProperty({
    description: 'Puede cerrar caja (rol CAJERO/ADMIN o flag UsuarioSedeRol.puedeCerrarCaja)',
    example: true,
  })
  canCerrarCaja: boolean;

  @ApiProperty({
    description: 'IDs de accesos rápidos del dashboard que el usuario NO debe ver. Override individual por encima del filtro por rol.',
    example: ['facturacion', 'monitor-productos'],
    type: [String],
  })
  accesosRapidosOcultos?: string[];

  @ApiProperty({
    description: 'Permisos granulares del catálogo (UsuarioSedeRol.permisos) consolidados entre las sedes del usuario. Ej: caja.abrir, venta.descuento-libre.',
    example: ['caja.abrir', 'venta.descuento-libre'],
    type: [String],
  })
  granularPermissions?: string[];

  @ApiProperty({
    description: 'Puede ver la lista de empleados',
    example: true,
  })
  canViewEmpleados: boolean;

  @ApiProperty({
    description: 'Puede gestionar empleados (crear, editar, cesar)',
    example: true,
  })
  canManageEmpleados: boolean;

  @ApiProperty({
    description: 'Puede ver registros de asistencia',
    example: true,
  })
  canViewAsistencia: boolean;

  @ApiProperty({
    description: 'Puede gestionar asistencia (registrar entrada/salida)',
    example: true,
  })
  canManageAsistencia: boolean;

  @ApiProperty({
    description: 'Puede ver planilla y boletas de pago',
    example: true,
  })
  canViewPlanilla: boolean;

  @ApiProperty({
    description: 'Puede gestionar planilla (calcular, pagar)',
    example: true,
  })
  canManagePlanilla: boolean;

  @ApiProperty({
    description: 'Puede aprobar/rechazar incidencias (vacaciones, licencias)',
    example: true,
  })
  canApproveIncidencias: boolean;

  @ApiProperty({
    description: 'Puede aprobar planilla para pago',
    example: true,
  })
  canApprovePlanilla: boolean;

  @ApiProperty({
    description: 'Puede ver gastos recurrentes (luz, agua, alquiler, etc.)',
    example: true,
  })
  canViewGastosRecurrentes: boolean;

  @ApiProperty({
    description: 'Puede gestionar gastos recurrentes (crear, editar, marcar pagado)',
    example: true,
  })
  canManageGastosRecurrentes: boolean;
}
