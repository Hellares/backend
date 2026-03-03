import { IsOptional, IsString, IsEnum, IsDateString, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EstadoOrdenCompra } from '@prisma/client';

export class QueryOrdenesCompraDto {
  @ApiPropertyOptional({ description: 'Elementos por página', example: 10, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Cursor para paginación (ID del último registro)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Filtrar por sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proveedor' })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado', enum: EstadoOrdenCompra })
  @IsOptional()
  @IsEnum(EstadoOrdenCompra)
  estado?: EstadoOrdenCompra;

  @ApiPropertyOptional({ description: 'Fecha desde' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Buscar por código o proveedor' })
  @IsOptional()
  @IsString()
  search?: string;
}
