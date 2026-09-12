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

export class ItemCostoVentaDto {
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
      'Unidades que se van a vender. MANDA: de ella depende de qué lotes sale ' +
      'la mercadería y, por lo tanto, cuánto costó. Vender 3 puede salir todo ' +
      'del lote barato; vender 5 arrastra 2 del caro. Omitida = 1.',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  cantidad?: number;

  @ApiPropertyOptional({
    description:
      'Cotizar contra ESTE lote en vez del que elegiría FEFO. Es lo que el ' +
      'cajero elige en el selector de lote, y tiene que viajar también acá: ' +
      'sin él la vista previa mostraría el costo del lote de FEFO y la venta ' +
      'cobraría el del lote elegido. Si la cantidad supera lo que queda en el ' +
      'lote, el resto se cotiza por FEFO y los tramos lo muestran.',
  })
  @IsOptional()
  @IsString()
  loteId?: string;
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
