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
}
