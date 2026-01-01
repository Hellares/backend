import {
  IsArray,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductoConDescuentoDto {
  @ApiProperty({
    description: 'ID del producto',
    example: 'prod-123',
  })
  @IsString()
  @IsNotEmpty()
  productoId: string;

  @ApiPropertyOptional({
    description:
      'Override de descuento para este producto específico (opcional)',
    example: 20.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  descuentoOverride?: number;
}

export class AsignarProductosDto {
  @ApiProperty({
    description: 'Productos a asignar con sus descuentos opcionales',
    type: [ProductoConDescuentoDto],
    example: [
      { productoId: 'prod-1', descuentoOverride: 20.0 },
      { productoId: 'prod-2' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductoConDescuentoDto)
  @IsNotEmpty()
  productos: ProductoConDescuentoDto[];
}
