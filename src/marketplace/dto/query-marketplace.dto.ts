import { IsOptional, IsString, IsNumber, Min, Max, IsIn, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';
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

  @ApiPropertyOptional({
    description:
      'Filtrar por valor de atributo, en formato `clave:valor`. Repetible. ' +
      'Claves distintas se combinan con Y y varios valores de la misma clave con O.',
    example: ['fabricante:QUALCOMM', 'procesador:8 Gen 3'],
    isArray: true,
    type: String,
  })
  @IsOptional()
  // Con un solo `?atributos=x:y` Nest entrega un string suelto, no un array.
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  })
  @IsArray()
  @IsString({ each: true })
  atributos?: string[];

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
