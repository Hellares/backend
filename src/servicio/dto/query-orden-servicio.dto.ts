import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import {
  EstadoOrdenServicio,
  TipoServicio,
  PrioridadServicio,
} from '@prisma/client';

export class QueryOrdenServicioDto {
  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Elementos por página', default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Búsqueda por código/descripción' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado',
    enum: EstadoOrdenServicio,
  })
  @IsOptional()
  @IsEnum(EstadoOrdenServicio)
  estado?: EstadoOrdenServicio;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de servicio',
    enum: TipoServicio,
  })
  @IsOptional()
  @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional({
    description: 'Filtrar por prioridad',
    enum: PrioridadServicio,
  })
  @IsOptional()
  @IsEnum(PrioridadServicio)
  prioridad?: PrioridadServicio;

  @ApiPropertyOptional({ description: 'Filtrar por cliente persona' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por cliente empresa' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por técnico' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'Fecha desde (ISO)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Cursor para paginación (ID del último elemento)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
