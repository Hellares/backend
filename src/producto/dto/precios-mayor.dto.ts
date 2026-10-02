import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ItemPrecioMayorDto {
  @ApiPropertyOptional({ description: 'ID del producto (omitir si la línea es de una variante)' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante. Si viene, MANDA sobre productoId.' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiPropertyOptional({
    description:
      'Unidades de la línea. Importa: quien ya llega por cantidad a un ' +
      'escalón mejor lo conserva, y el mayoreo combinado del carrito cuenta.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  cantidad?: number;

  @ApiPropertyOptional({
    description: 'Nivel por mayor elegido. Omitido = el primer escalón.',
  })
  @IsOptional()
  @IsString()
  nivelId?: string;
}

export class PreciosMayorQueryDto {
  @ApiProperty({ description: 'Sede desde la que se vende: el precio es POR SEDE' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({
    description:
      'Las líneas del carrito, TODAS juntas: el mayoreo combinado se mide ' +
      'sobre el carrito entero.',
    type: [ItemPrecioMayorDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemPrecioMayorDto)
  items: ItemPrecioMayorDto[];
}
