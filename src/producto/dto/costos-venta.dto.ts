import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ItemCostoVentaDto {
  @ApiPropertyOptional({ description: 'ID del producto (omitir si la línea es de una variante)' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante. Si viene, MANDA sobre productoId.' })
  @IsOptional()
  @IsString()
  varianteId?: string;
}

export class CostosVentaQueryDto {
  @ApiProperty({ description: 'Sede desde la que se vende: el costo es POR SEDE' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({
    description:
      'Las líneas del carrito. Se pregunta por todas juntas porque el ' +
      'interruptor de "vender a costo" las necesita a la vez.',
    type: [ItemCostoVentaDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemCostoVentaDto)
  items: ItemCostoVentaDto[];
}
