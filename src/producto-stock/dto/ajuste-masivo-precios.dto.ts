import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoAjustePrecio {
  PORCENTAJE = 'PORCENTAJE',
  MONTO_FIJO = 'MONTO_FIJO',
}

export enum CampoAplicarPrecio {
  PRECIO = 'PRECIO',
  PRECIO_COSTO = 'PRECIO_COSTO',
}

export enum OperacionPrecio {
  AUMENTAR = 'AUMENTAR',
  DISMINUIR = 'DISMINUIR',
}

/**
 * DTO para ajuste masivo de precios en una sede
 * Permite actualizar precios de todos los productos de una sede
 */
export class AjusteMasivoPreciosDto {
  @ApiProperty({
    description: 'Tipo de ajuste a aplicar',
    enum: TipoAjustePrecio,
    example: TipoAjustePrecio.PORCENTAJE,
  })
  @IsEnum(TipoAjustePrecio)
  tipo: TipoAjustePrecio;

  @ApiProperty({
    description:
      'Valor del ajuste (porcentaje sin % o monto fijo según el tipo)',
    example: 10,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  valor: number;

  @ApiProperty({
    description: 'Campo de precio al que se aplicará el ajuste',
    enum: CampoAplicarPrecio,
    example: CampoAplicarPrecio.PRECIO,
  })
  @IsEnum(CampoAplicarPrecio)
  aplicarA: CampoAplicarPrecio;

  @ApiProperty({
    description: 'Operación a realizar',
    enum: OperacionPrecio,
    example: OperacionPrecio.AUMENTAR,
  })
  @IsEnum(OperacionPrecio)
  operacion: OperacionPrecio;

  @ApiPropertyOptional({
    description:
      'IDs de productos específicos a actualizar (si no se especifica, aplica a todos)',
    type: [String],
    example: ['prod-123', 'prod-456'],
  })
  @IsOptional()
  @IsArray()
  productoIds?: string[];

  @ApiPropertyOptional({
    description: 'Si true, excluye productos que son combos (esCombo=true)',
    example: true,
  })
  @IsOptional()
  excluirCombos?: boolean;

  @ApiPropertyOptional({
    description: 'Si true, solo afecta combos con tipo FIJO (los demás no tienen sentido ajustar masivamente)',
    example: false,
  })
  @IsOptional()
  soloCombos?: boolean;
}
