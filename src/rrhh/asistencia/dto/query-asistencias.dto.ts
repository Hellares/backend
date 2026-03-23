import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoAsistencia } from '@prisma/client';

export class QueryAsistenciasDto {
  @ApiPropertyOptional({
    description: 'Filtrar por empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  empleadoId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por sede',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Fecha desde (inclusive)',
    example: '2026-03-01',
  })
  @IsOptional()
  @IsDateString({}, { message: 'fechaDesde debe ser una fecha válida (ISO 8601)' })
  fechaDesde?: string;

  @ApiPropertyOptional({
    description: 'Fecha hasta (inclusive)',
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateString({}, { message: 'fechaHasta debe ser una fecha válida (ISO 8601)' })
  fechaHasta?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado de asistencia',
    enum: EstadoAsistencia,
    example: EstadoAsistencia.PRESENTE,
  })
  @IsOptional()
  @IsEnum(EstadoAsistencia, { message: 'Estado de asistencia inválido' })
  estado?: EstadoAsistencia;

  @ApiPropertyOptional({
    description: 'Página actual',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 50;
}
