import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CrearStockDto {
  @ApiProperty({
    description: 'ID de la sede',
    example: 'sede-id-123',
  })
  @IsString()
  sedeId: string;

  @ApiProperty({
    description: 'ID del producto (requerido si no hay varianteId)',
    example: 'producto-id-123',
  })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({
    description: 'ID de la variante (requerido si no hay productoId)',
    example: 'variante-id-123',
  })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({
    description: 'Stock inicial',
    example: 100,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stockActual: number;

  @ApiPropertyOptional({
    description: 'Stock mínimo',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional({
    description: 'Stock máximo',
    example: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional({
    description: 'Ubicación física en el almacén',
    example: 'Pasillo 3, Estante B',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;

  // ==========================================
  // PRECIOS POR SEDE (opcionales)
  // Si no se especifican, se usarán los precios del producto/variante base
  // ==========================================

  @ApiPropertyOptional({
    description:
      'Precio de venta en esta sede (si no se especifica, usa precio del producto/variante)',
    example: 99.99,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precio?: number;

  @ApiPropertyOptional({
    description:
      'Precio de costo en esta sede (para cálculo de márgenes)',
    example: 50.0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioCosto?: number;

  @ApiPropertyOptional({
    description: 'Precio de oferta específico de la sede',
    example: 79.99,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOferta?: number;

  @ApiPropertyOptional({
    description: 'Si el producto está en oferta en esta sede',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enOferta?: boolean;

  @ApiPropertyOptional({
    description: 'Fecha de inicio de oferta en esta sede',
    example: '2024-01-15T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  fechaInicioOferta?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin de oferta en esta sede',
    example: '2024-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  fechaFinOferta?: string;
}
