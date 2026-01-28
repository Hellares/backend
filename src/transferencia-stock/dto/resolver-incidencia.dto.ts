import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Acciones que se pueden tomar para resolver una incidencia
 */
export enum AccionResolucionIncidencia {
  DEVOLVER_ORIGEN = 'DEVOLVER_ORIGEN', // Crear transferencia inversa automática
  DAR_DE_BAJA = 'DAR_DE_BAJA', // Eliminar del inventario (baja definitiva)
  REPARAR = 'REPARAR', // Mover a stockEnGarantia
  ACEPTAR_CON_DESCUENTO = 'ACEPTAR_CON_DESCUENTO', // Mover a vendible (stockActual)
  RECLAMAR_PROVEEDOR = 'RECLAMAR_PROVEEDOR', // Solo marcar como resuelto, gestión externa
}

/**
 * DTO para resolver una incidencia de transferencia
 */
export class ResolverIncidenciaDto {
  @ApiProperty({
    enum: AccionResolucionIncidencia,
    description:
      'Acción a tomar para resolver la incidencia. ' +
      'DEVOLVER_ORIGEN: Crea automáticamente una transferencia de devolución. ' +
      'DAR_DE_BAJA: Elimina permanentemente del inventario. ' +
      'REPARAR: Mueve los productos a stockEnGarantia. ' +
      'ACEPTAR_CON_DESCUENTO: Mueve productos dañados a vendibles (para venta con descuento). ' +
      'RECLAMAR_PROVEEDOR: Solo marca como resuelto, gestión externa.',
    example: 'DEVOLVER_ORIGEN',
  })
  @IsEnum(AccionResolucionIncidencia)
  accion: AccionResolucionIncidencia;

  @ApiPropertyOptional({
    description:
      'Observaciones sobre la resolución. Por ejemplo: motivo de la baja, ' +
      'condiciones del descuento, número de reclamo al proveedor, etc.',
    example:
      'Se coordinó devolución con transporte. Fecha estimada de llegada: 2 días',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
