import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoIncidencia, EstadoIncidencia } from '@prisma/client';

export class QueryIncidenciasDto {
  @ApiPropertyOptional({
    description: 'Filtrar por empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  empleadoId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de incidencia',
    enum: TipoIncidencia,
    example: TipoIncidencia.VACACION,
  })
  @IsOptional()
  @IsEnum(TipoIncidencia, { message: 'Tipo de incidencia inválido' })
  tipo?: TipoIncidencia;

  @ApiPropertyOptional({
    description: 'Filtrar por estado de la incidencia',
    enum: EstadoIncidencia,
    example: EstadoIncidencia.PENDIENTE,
  })
  @IsOptional()
  @IsEnum(EstadoIncidencia, { message: 'Estado de incidencia inválido' })
  estado?: EstadoIncidencia;

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
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
