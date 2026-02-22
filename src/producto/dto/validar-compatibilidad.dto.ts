import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductoCompatibilidadItem {
  @IsString()
  @IsOptional()
  productoId?: string;

  @IsString()
  @IsOptional()
  varianteId?: string;
}

export class ValidarCompatibilidadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => ProductoCompatibilidadItem)
  productos: ProductoCompatibilidadItem[];
}
