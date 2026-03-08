import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

enum EstadoTercerizacion {
  PENDIENTE = 'PENDIENTE',
  ACEPTADO = 'ACEPTADO',
  RECHAZADO = 'RECHAZADO',
  EN_PROCESO = 'EN_PROCESO',
  COMPLETADO = 'COMPLETADO',
  CANCELADO = 'CANCELADO',
}

export class QueryTercerizacionDto {
  @ApiPropertyOptional({ description: 'Filtrar por estado' })
  @IsOptional()
  @IsEnum(EstadoTercerizacion)
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
