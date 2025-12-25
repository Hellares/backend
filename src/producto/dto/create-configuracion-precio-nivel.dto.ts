import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';

export enum TipoPrecioNivel {
  PRECIO_FIJO = 'PRECIO_FIJO',
  PORCENTAJE_DESCUENTO = 'PORCENTAJE_DESCUENTO',
}

export class CreateConfiguracionPrecioNivelDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del nivel es requerido' })
  nombre: string;

  @IsInt()
  @Min(1, { message: 'La cantidad mínima debe ser al menos 1' })
  cantidadMinima: number;

  @IsInt()
  @IsOptional()
  @Min(1, { message: 'La cantidad máxima debe ser al menos 1' })
  @ValidateIf((o) => o.cantidadMaxima !== null)
  cantidadMaxima?: number | null;

  @IsEnum(TipoPrecioNivel)
  tipoPrecio: TipoPrecioNivel;

  @IsNumber()
  @Min(0, { message: 'El porcentaje debe ser al menos 0' })
  @Max(100, { message: 'El porcentaje no puede exceder 100' })
  @IsOptional()
  @ValidateIf((o) => o.tipoPrecio === TipoPrecioNivel.PORCENTAJE_DESCUENTO)
  porcentajeDesc?: number;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  orden?: number;
}
