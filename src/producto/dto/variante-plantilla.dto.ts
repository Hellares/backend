import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ValorPlantillaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  atributoId: string;

  @ApiProperty({ example: 'TELA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  valor: string;
}

export class NivelPlantillaDto {
  @ApiProperty({ example: 'Por Mayor' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  cantidadMinima: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidadMaxima?: number | null;

  @ApiProperty({ enum: ['PRECIO_FIJO', 'PORCENTAJE_DESCUENTO'] })
  @IsIn(['PRECIO_FIJO', 'PORCENTAJE_DESCUENTO'])
  tipoPrecio: 'PRECIO_FIJO' | 'PORCENTAJE_DESCUENTO';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precio?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  porcentajeDesc?: number | null;
}

export class CombinacionPlantillaDto {
  @ApiProperty({ type: [ValorPlantillaDto], description: 'Valores SIN el atributo de colección' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ValorPlantillaDto)
  valores: ValorPlantillaDto[];

  @ApiPropertyOptional({ description: 'Precio de venta sugerido' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precio?: number | null;

  @ApiPropertyOptional({ description: 'Costo sugerido' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precioCosto?: number | null;

  @ApiPropertyOptional({ type: [NivelPlantillaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NivelPlantillaDto)
  niveles?: NivelPlantillaDto[];
}

/** Crear o reemplazar una plantilla de variantes. */
export class GuardarVariantePlantillaDto {
  @ApiProperty({ example: 'Edredones' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  descripcion?: string;

  @ApiProperty({ description: 'El atributo que cambia en cada colección nueva' })
  @IsString()
  @IsNotEmpty()
  atributoColeccionId: string;

  @ApiProperty({ description: 'Atributos de las combinaciones, en orden (sin el de colección)' })
  @IsArray()
  @IsString({ each: true })
  atributoIds: string[];

  @ApiProperty({ type: [CombinacionPlantillaDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CombinacionPlantillaDto)
  combinaciones: CombinacionPlantillaDto[];
}

/** Crear una plantilla copiando la estructura de una colección existente. */
export class VariantePlantillaDesdeColeccionDto {
  @ApiProperty({ example: 'Edredones' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @ApiProperty({ description: 'El atributo que es la colección (ej. "Colección")' })
  @IsString()
  @IsNotEmpty()
  atributoColeccionId: string;

  @ApiProperty({ example: 'CRISTAL', description: 'La colección que se toma como modelo' })
  @IsString()
  @IsNotEmpty()
  valorColeccion: string;
}

export class CombinacionAAplicarDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  combinacionId: string;

  @ApiPropertyOptional({ description: 'Precio para esta colección (si no, el sugerido)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precio?: number | null;

  @ApiPropertyOptional({ description: 'Costo para esta colección (si no, el sugerido)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precioCosto?: number | null;
}

/** Aplicar una plantilla en un producto: crea la colección nueva. */
export class AplicarVariantePlantillaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @ApiProperty({ example: 'DINOSAURIO' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  valorColeccion: string;

  @ApiPropertyOptional({
    type: [CombinacionAAplicarDto],
    description: 'Las combinaciones a crear. Sin esto, todas las de la plantilla.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CombinacionAAplicarDto)
  combinaciones?: CombinacionAAplicarDto[];
}
