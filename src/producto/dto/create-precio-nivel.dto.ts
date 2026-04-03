import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPrecioNivel } from '@prisma/client';

export class CreatePrecioNivelDto {
  @ApiProperty({
    description: 'Nombre del nivel de precio',
    example: 'Por Mayor',
  })
  @IsString()
  nombre: string;

  @ApiProperty({
    description: 'Cantidad mínima para aplicar este precio',
    example: 6,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidadMinima: number;

  @ApiPropertyOptional({
    description: 'Cantidad máxima para este nivel (null = sin límite)',
    example: 11,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidadMaxima?: number;

  @ApiProperty({
    description: 'Tipo de precio: PRECIO_FIJO o PORCENTAJE_DESCUENTO',
    enum: TipoPrecioNivel,
    example: TipoPrecioNivel.PRECIO_FIJO,
  })
  @IsEnum(TipoPrecioNivel)
  tipoPrecio: TipoPrecioNivel;

  @ApiPropertyOptional({
    description: 'Precio fijo para este nivel (requerido si tipoPrecio es PRECIO_FIJO)',
    example: 1350.0,
    type: Number,
  })
  @ValidateIf((o) => o.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  precio?: number;

  @ApiPropertyOptional({
    description:
      'Porcentaje de descuento (0-100) (requerido si tipoPrecio es PORCENTAJE_DESCUENTO)',
    example: 10.0,
    minimum: 0,
    maximum: 100,
    type: Number,
  })
  @ValidateIf((o) => o.tipoPrecio === TipoPrecioNivel.PORCENTAJE_DESCUENTO)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  porcentajeDesc?: number;

  @ApiPropertyOptional({
    description: 'Descripción opcional del nivel de precio',
    example: '10% de descuento en compras de 6 a 11 unidades',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Orden de visualización',
    example: 1,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  orden?: number;
}
