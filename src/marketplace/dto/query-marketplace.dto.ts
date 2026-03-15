import { IsOptional, IsString, IsNumber, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryMarketplaceProductosDto {
  @ApiPropertyOptional({ description: 'Búsqueda por nombre o descripción' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'ID de categoría maestra' })
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional({ description: 'ID de marca maestra' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ description: 'Precio mínimo' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioMin?: number;

  @ApiPropertyOptional({ description: 'Precio máximo' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioMax?: number;

  @ApiPropertyOptional({ description: 'Departamento de la empresa' })
  @IsOptional()
  @IsString()
  departamento?: string;

  @ApiPropertyOptional({ description: 'Ordenar por', enum: ['relevancia', 'precio_asc', 'precio_desc', 'recientes'] })
  @IsOptional()
  @IsIn(['relevancia', 'precio_asc', 'precio_desc', 'recientes'])
  orden?: string;

  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Límite por página', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}
