import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EstadoLote } from '@prisma/client';

export class QueryLotesDto {
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

  @ApiPropertyOptional({ description: 'Filtrar por productoStockId' })
  @IsOptional()
  @IsString()
  productoStockId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proveedor' })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado', enum: EstadoLote })
  @IsOptional()
  @IsEnum(EstadoLote)
  estado?: EstadoLote;

  @ApiPropertyOptional({ description: 'Buscar por código o número de lote' })
  @IsOptional()
  @IsString()
  search?: string;
}
