import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoCompra } from '@prisma/client';

export class QueryComprasDto {
  @ApiPropertyOptional({ description: 'Filtrar por sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proveedor' })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado', enum: EstadoCompra })
  @IsOptional()
  @IsEnum(EstadoCompra)
  estado?: EstadoCompra;

  @ApiPropertyOptional({ description: 'Filtrar por orden de compra' })
  @IsOptional()
  @IsString()
  ordenCompraId?: string;

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
