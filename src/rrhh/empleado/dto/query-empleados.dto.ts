import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoEmpleado, TipoContrato } from '@prisma/client';

export class QueryEmpleadosDto {
  @ApiPropertyOptional({
    description: 'Filtrar por sede',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del empleado',
    enum: EstadoEmpleado,
    example: EstadoEmpleado.ACTIVO,
  })
  @IsOptional()
  @IsEnum(EstadoEmpleado, { message: 'Estado de empleado inválido' })
  estado?: EstadoEmpleado;

  @ApiPropertyOptional({
    description: 'Filtrar por departamento',
    example: 'Ventas',
  })
  @IsOptional()
  @IsString()
  departamento?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de contrato',
    enum: TipoContrato,
    example: TipoContrato.PLANILLA,
  })
  @IsOptional()
  @IsEnum(TipoContrato, { message: 'Tipo de contrato inválido' })
  tipoContrato?: TipoContrato;

  @ApiPropertyOptional({
    description: 'Buscar por nombres, apellidos o DNI del usuario vinculado',
    example: 'Juan',
  })
  @IsOptional()
  @IsString()
  search?: string;

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
