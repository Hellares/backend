import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para las estadísticas de la empresa
 */
export class EmpresaStatisticsDto {
  @ApiProperty({
    description: 'Total de productos activos',
    example: 150,
  })
  totalProductos: number;

  @ApiProperty({
    description: 'Total de servicios activos',
    example: 25,
  })
  totalServicios: number;

  @ApiProperty({
    description: 'Total de usuarios activos',
    example: 10,
  })
  totalUsuarios: number;

  @ApiProperty({
    description: 'Total de sedes activas',
    example: 3,
  })
  totalSedes: number;

  @ApiProperty({
    description: 'Total de cotizaciones',
    example: 5,
  })
  totalCotizaciones: number;

  @ApiProperty({
    description: 'Total de proveedores activos',
    example: 8,
  })
  totalProveedores: number;

  @ApiProperty({
    description: 'Total de órdenes de servicio pendientes',
    example: 12,
  })
  ordenesPendientes: number;

  @ApiProperty({
    description: 'Total de comprobantes emitidos este mes',
    example: 85,
    required: false,
  })
  comprobantesMes?: number;

  @ApiProperty({
    description: 'Ingresos totales del mes actual (en moneda local)',
    example: 25000.50,
    required: false,
  })
  ingresosMes?: number;
}
