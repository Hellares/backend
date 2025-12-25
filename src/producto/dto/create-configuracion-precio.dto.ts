import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateConfiguracionPrecioNivelDto } from './create-configuracion-precio-nivel.dto';

export class CreateConfiguracionPrecioDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la configuración es requerido' })
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Debe incluir al menos un nivel de precio',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateConfiguracionPrecioNivelDto)
  niveles: CreateConfiguracionPrecioNivelDto[];
}
