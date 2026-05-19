import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  IsNotEmpty,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrdenCompraDetalleDto {
  @ApiPropertyOptional({ description: 'ID del producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({ description: 'Descripción del item' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiProperty({ description: 'Cantidad', example: 10 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario', example: 100 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario: number;

  @ApiPropertyOptional({ description: 'Descuento por línea', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Porcentaje de IGV', example: 18 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  porcentajeIGV?: number;

  // ─── Unidad de Compra ─────────────────────────────────────────
  @ApiPropertyOptional({
    description:
      'Si true: cantidad y precioUnitario están en la unidad de COMPRA del producto y serán convertidos a unidad atómica antes de persistir.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  usaUnidadCompra?: boolean;
}
