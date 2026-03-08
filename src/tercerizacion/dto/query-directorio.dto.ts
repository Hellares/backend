import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryDirectorioDto {
  @ApiPropertyOptional({ description: 'Buscar por nombre de empresa' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de servicio (ej: REPARACION)' })
  @IsOptional()
  @IsString()
  tipoServicio?: string;

  @ApiPropertyOptional({ description: 'Filtrar por departamento' })
  @IsOptional()
  @IsString()
  departamento?: string;

  @ApiPropertyOptional({ description: 'Filtrar por distrito' })
  @IsOptional()
  @IsString()
  distrito?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
