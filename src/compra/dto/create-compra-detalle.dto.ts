import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  IsNotEmpty,
  IsBoolean,
  IsPositive,
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

  @ApiPropertyOptional({
    description:
      'Override puntual del factor de compra para ESTA línea (ej. el saco vino con 40 unidades en vez de las 50 configuradas). Solo aplica si usaUnidadCompra=true. NO modifica la configuración del producto; el valor usado se snapshotea en CompraDetalle.factorAplicado. Si se omite, se usa el factorCompra actual del producto.',
    example: 40,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  factorCompra?: number;

  @ApiPropertyOptional({
    description:
      'Nuevo precio de venta a aplicar al confirmar la compra. Si está presente, al confirmar se actualiza ProductoStock.precio del producto en la sede de la compra + se registra en historial. Si null/omitido, el precio venta no cambia.',
    example: 3.50,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  nuevoPrecioVenta?: number;
}
