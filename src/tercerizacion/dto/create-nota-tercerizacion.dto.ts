import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Nota manual en la bitácora de una tercerización. Solo NOTA o REQUERIMIENTO;
 *  CAMBIO_ESTADO/SISTEMA las genera el backend en las transiciones. */
export class CreateNotaTercerizacionDto {
  @ApiProperty({ description: 'Contenido de la nota/requerimiento' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  contenido: string;

  @ApiPropertyOptional({ description: 'Tipo de nota manual', enum: ['NOTA', 'REQUERIMIENTO'] })
  @IsOptional()
  @IsIn(['NOTA', 'REQUERIMIENTO'])
  tipo?: 'NOTA' | 'REQUERIMIENTO';
}
