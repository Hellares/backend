import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para los permisos del usuario en la empresa
 */
export class EmpresaPermissionsDto {
  @ApiProperty({
    description: 'Puede gestionar usuarios de la empresa',
    example: true,
  })
  canManageUsers: boolean;

  @ApiProperty({
    description: 'Puede gestionar productos',
    example: true,
  })
  canManageProducts: boolean;

  @ApiProperty({
    description: 'Puede gestionar servicios',
    example: true,
  })
  canManageServices: boolean;

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
