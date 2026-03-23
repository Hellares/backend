import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AprobarIncidenciaDto {
  @ApiPropertyOptional({
    description: 'Observaciones al aprobar la incidencia',
    example: 'Aprobado según política de vacaciones',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
