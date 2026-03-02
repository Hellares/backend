import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoLote } from '@prisma/client';

export class QueryLotesDto {
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
