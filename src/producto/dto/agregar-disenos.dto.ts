import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisenoNuevoDto {
  @ApiProperty({ description: 'Foto (subida a la base de la colección) que identifica el diseño' })
  @IsString()
  @IsNotEmpty()
  archivoId: string;

  @ApiProperty({
    description:
      'Unidades que entran ya. 0 = se crea sin stock y las unidades entran después con una compra.',
    example: 0,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  cantidad: number;

  @ApiPropertyOptional({
    description: 'Costo unitario de lo que entra ahora. Sin él, el costo actual de la colección.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costoUnitario?: number;

  @ApiPropertyOptional({
    description:
      'Precio de venta en la sede. Sin él, el de la colección (un diseño exclusivo puede costar más).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precioVenta?: number;
}

/**
 * Agregar diseños nuevos a una colección que ya tiene: llegaron estampados
 * nuevos de "CRISTAL" y se crean D4, D5… con su foto. Las unidades no salen
 * de ninguna variante: o entran ahora como ingreso, o con una compra después.
 */
export class AgregarDisenosDto {
  @ApiProperty({ description: 'Sede donde entran las unidades (y la del stock en 0)' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ type: [DisenoNuevoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DisenoNuevoDto)
  disenos: DisenoNuevoDto[];
}
