import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Fila de la edición masiva: identifica un producto o variante
 * (exactamente uno de los dos) y los cambios a aplicar en la sede.
 */
export class BulkEditarItemDto {
  @ApiPropertyOptional({ description: 'ID de la variante (excluyente con productoId)' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiPropertyOptional({ description: 'ID del producto simple (excluyente con varianteId)' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({
    description: 'Cantidad a agregar al stock (negativa para descontar). Genera movimiento de kardex.',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  agregarStock?: number;

  @ApiPropertyOptional({ description: 'Nuevo precio de venta', example: 45.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precio?: number;

  @ApiPropertyOptional({ description: 'Nuevo precio de costo', example: 30.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioCosto?: number;

  // ─── Precio por mayor (PrecioNivel) ──────────────────────────────
  // Ojo: a diferencia de precio y precioCosto, que son POR SEDE, el nivel
  // es GLOBAL a la variante — PrecioNivel no tiene sedeId. Editarlo desde
  // una sede lo cambia para todas.

  @ApiPropertyOptional({
    description:
      'Cantidad mínima desde la que aplica el precio por mayor. Va junto con mayorPrecio.',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(2, { message: 'La cantidad mínima del precio por mayor debe ser al menos 2' })
  @Type(() => Number)
  mayorCantidadMinima?: number;

  @ApiPropertyOptional({
    description: 'Precio por mayor (PRECIO_FIJO). Va junto con mayorCantidadMinima.',
    example: 72.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  mayorPrecio?: number;

  @ApiPropertyOptional({
    description:
      'Elimina el nivel por mayor de esta variante/producto. Excluyente con mayorPrecio.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  mayorEliminar?: boolean;
}

/**
 * DTO para edición masiva de stock y precios de una sede (grilla).
 * Todo se aplica en una sola transacción: o entran todas las filas o ninguna.
 */
export class BulkEditarStockPreciosDto {
  @ApiProperty({ type: [BulkEditarItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditarItemDto)
  items: BulkEditarItemDto[];

  @ApiPropertyOptional({
    description: 'Motivo registrado en el kardex y el historial de precios',
    example: 'Edición masiva de inventario',
  })
  @IsOptional()
  @IsString()
  motivo?: string;
}
