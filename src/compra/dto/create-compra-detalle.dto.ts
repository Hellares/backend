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

export class CreateCompraDetalleDto {
  @ApiPropertyOptional({ description: 'ID del detalle de OC (si viene de OC)' })
  @IsOptional()
  @IsString()
  ordenCompraDetalleId?: string;

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

  @ApiProperty({ description: 'Cantidad recibida', example: 10 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario de compra', example: 100 })
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
  // Si la línea fue ingresada en la unidad de COMPRA del producto
  // (PAQUETE/KG/DOCENA), el service convierte `cantidad` y
  // `precioUnitario` a unidad atómica (de venta/stock) antes de
  // persistir, multiplicando/dividiendo por el `factorCompra` actual
  // del producto. Snapshot del factor y de la cantidad original se
  // guardan en el CompraDetalle para mostrar dual-view después.
  @ApiPropertyOptional({
    description:
      'Si true: cantidad y precioUnitario están en la unidad de COMPRA del producto y serán convertidos a unidad atómica (×factorCompra y ÷factorCompra respectivamente). Requiere que el producto tenga unidadCompraId+factorCompra.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  usaUnidadCompra?: boolean;
}
