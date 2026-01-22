import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AprobarTransferenciaDto {
  @ApiPropertyOptional({
    description: 'Observaciones al aprobar',
    example: 'Aprobado - Preparar para envío',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
