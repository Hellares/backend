import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalcularDescuentoDto {
  @ApiProperty({
    description: 'ID del usuario comprador',
    example: 'user-123',
  })
  @IsString()
  @IsNotEmpty()
  usuarioId: string;

  @ApiProperty({
    description: 'ID del producto',
    example: 'prod-123',
  })
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @ApiPropertyOptional({
    description: 'ID de la variante del producto (opcional)',
    example: 'var-123',
  })
  @IsString()
  @IsOptional()
  varianteId?: string;

  @ApiProperty({
    description: 'Cantidad de productos',
    example: 5,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number;

  @ApiProperty({
    description: 'Precio base del producto',
    example: 100.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  precioBase: number;

  @ApiPropertyOptional({
    description: 'Precio promocional del producto (si tiene promoción activa)',
    example: 80.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  precioPromocion?: number;

  @ApiPropertyOptional({
    description:
      'Si true, aplica el descuento sobre el precio promocional (apilar descuentos). Si false, retorna el mejor precio entre promoción y descuento.',
    example: false,
    default: false,
  })
  @IsOptional()
  aplicarSobrePromocion?: boolean;
}
