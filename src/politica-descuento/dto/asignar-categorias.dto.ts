import {
  IsArray,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoriaConDescuentoDto {
  @ApiProperty({
    description: 'ID de la categoría',
    example: 'cat-123',
  })
  @IsString()
  @IsNotEmpty()
  categoriaId: string;

  @ApiPropertyOptional({
    description:
      'Override de descuento para esta categoría específica (opcional)',
    example: 15.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  descuentoOverride?: number;
}

export class AsignarCategoriasDto {
  @ApiProperty({
    description: 'Categorías a asignar con sus descuentos opcionales',
    type: [CategoriaConDescuentoDto],
    example: [
      { categoriaId: 'cat-1', descuentoOverride: 15.0 },
      { categoriaId: 'cat-2' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoriaConDescuentoDto)
  @IsNotEmpty()
  categorias: CategoriaConDescuentoDto[];
}
