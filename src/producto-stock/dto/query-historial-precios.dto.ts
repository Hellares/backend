import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TipoCambioPrecio } from '@prisma/client';

export class QueryHistorialPreciosDto {
  @ApiPropertyOptional({ description: 'Filtrar por sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  fechaInicio?: string;

  @ApiPropertyOptional({ description: 'Fecha fin (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  fechaFin?: string;

  @ApiPropertyOptional({ enum: TipoCambioPrecio, description: 'Filtrar por tipo de cambio' })
  @IsOptional()
  @IsEnum(TipoCambioPrecio)
  tipoCambio?: TipoCambioPrecio;

  @ApiPropertyOptional({ description: 'Buscar por nombre de producto' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Cursor del ultimo registro para paginacion' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
