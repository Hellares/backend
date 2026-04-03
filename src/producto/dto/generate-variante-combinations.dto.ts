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

  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  precioBase: number;

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
