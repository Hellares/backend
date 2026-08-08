import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, ValidateNested, ArrayMinSize, Min, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class AtributoCombinacionDto {
  @IsString()
  @IsNotEmpty()
  atributoId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  valores: string[];
}

export class GenerateVarianteCombinationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AtributoCombinacionDto)
  @ArrayMinSize(1)
  atributos: AtributoCombinacionDto[];

  /**
   * Precio de venta con el que nacen TODAS las variantes de esta generación.
   * Opcional: cuando las combinaciones no comparten precio (un granel se cobra
   * por gramo y su saco por unidad) mandarlo sería inventar un número. Sin él
   * las variantes nacen con `precioConfigurado: false` y se les pone precio una
   * por una.
   *
   * El piso es sub-céntimo a propósito: es un precio POR UNIDAD DE VENTA, no un
   * monto. Un granel guardado en gramos vale 0.008/g (S/8 el kilo) y con un
   * mínimo de 0.01 quedaba imposible de cargar.
   */
  @IsNumber()
  @Type(() => Number)
  @Min(0.000001)
  @IsOptional()
  precioBase?: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  precioCosto?: number;

  @IsString()
  @IsOptional()
  skuBase?: string;

  @IsEnum(['EQUITATIVO', 'SIN_STOCK'])
  @IsOptional()
  stockDistribucion?: 'EQUITATIVO' | 'SIN_STOCK';

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  stockTotal?: number;
}
