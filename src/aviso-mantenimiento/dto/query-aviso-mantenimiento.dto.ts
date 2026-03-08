import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { EstadoAviso } from '@prisma/client';

export class QueryAvisoMantenimientoDto {
  @ApiPropertyOptional({ description: 'Filtrar por estado', enum: EstadoAviso })
  @IsOptional()
  @IsEnum(EstadoAviso)
  estado?: EstadoAviso;

  @ApiPropertyOptional({ description: 'Filtrar por cliente' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de servicio' })
  @IsOptional()
  @IsString()
  tipoServicio?: string;

  @ApiPropertyOptional({ description: 'Fecha desde (fechaRecomendada)' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (fechaRecomendada)' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Cursor para paginación' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Límite de resultados', default: 20 })
  @IsOptional()
  limit?: number;
}
