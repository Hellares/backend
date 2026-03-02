import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoOrdenCompra } from '@prisma/client';

export class QueryOrdenesCompraDto {
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
