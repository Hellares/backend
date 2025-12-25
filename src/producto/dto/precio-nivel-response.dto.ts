import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoPrecioNivel } from '@prisma/client';

export class PrecioNivelResponseDto {
  @ApiProperty({
    description: 'ID del nivel de precio',
    example: 'clxyz123abc',
  })
  id: string;

  @ApiPropertyOptional({
    description: 'ID del producto (si aplica a producto base)',
    example: 'clxyz456def',
    nullable: true,
  })
  productoId: string | null;

  @ApiPropertyOptional({
    description: 'ID de la variante (si aplica a variante específica)',
    example: 'clxyz789ghi',
    nullable: true,
  })
  varianteId: string | null;

  @ApiProperty({
    description: 'Nombre del nivel de precio',
    example: 'Por Mayor',
  })
  nombre: string;

  @ApiProperty({
    description: 'Cantidad mínima para aplicar este precio',
    example: 6,
  })
  cantidadMinima: number;

  @ApiPropertyOptional({
    description: 'Cantidad máxima para este nivel (null = sin límite)',
    example: 11,
    nullable: true,
  })
  cantidadMaxima: number | null;

  @ApiProperty({
    description: 'Tipo de precio',
    enum: TipoPrecioNivel,
    example: TipoPrecioNivel.PRECIO_FIJO,
  })
  tipoPrecio: TipoPrecioNivel;

  @ApiPropertyOptional({
    description: 'Precio fijo para este nivel',
    example: 1350.0,
    nullable: true,
    type: Number,
  })
  precio: number | null;

  @ApiPropertyOptional({
    description: 'Porcentaje de descuento',
    example: 10.0,
    nullable: true,
    type: Number,
  })
  porcentajeDesc: number | null;

  @ApiPropertyOptional({
    description: 'Descripción del nivel',
    example: '10% de descuento en compras de 6 a 11 unidades',
    nullable: true,
  })
  descripcion: string | null;

  @ApiProperty({
    description: 'Orden de visualización',
    example: 1,
  })
  orden: number;

  @ApiProperty({
    description: 'Si el nivel está activo',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Fecha de creación',
    example: '2024-01-15T10:30:00Z',
  })
  creadoEn: Date;

  @ApiProperty({
    description: 'Fecha de última actualización',
    example: '2024-01-15T10:30:00Z',
  })
  actualizadoEn: Date;

  /**
   * Calcula el precio final para este nivel basado en el precio base
   */
  @ApiPropertyOptional({
    description: 'Precio final calculado (solo se incluye si se proporciona precioBase)',
    example: 1350.0,
    type: Number,
  })
  precioFinal?: number;
}
