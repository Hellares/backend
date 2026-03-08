import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoAviso } from '@prisma/client';

export class UpdateEstadoAvisoDto {
  @ApiProperty({ description: 'Nuevo estado del aviso', enum: EstadoAviso })
  @IsEnum(EstadoAviso)
  nuevoEstado: EstadoAviso;

  @ApiPropertyOptional({ description: 'Notas adicionales' })
  @IsOptional()
  @IsString()
  notas?: string;
}
