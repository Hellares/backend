import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

enum EstadoVinculacion {
  PENDIENTE = 'PENDIENTE',
  ACEPTADA = 'ACEPTADA',
  RECHAZADA = 'RECHAZADA',
  CANCELADA = 'CANCELADA',
  DESVINCULADA = 'DESVINCULADA',
}

export class QueryVinculacionDto {
  @ApiPropertyOptional({ description: 'Filtrar por estado' })
  @IsOptional()
  @IsEnum(EstadoVinculacion)
  estado?: string;

  @ApiPropertyOptional({ description: 'Tipo: enviadas o recibidas', enum: ['enviadas', 'recibidas'] })
  @IsOptional()
  @IsString()
  tipo?: 'enviadas' | 'recibidas';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
