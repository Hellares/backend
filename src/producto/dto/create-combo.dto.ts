import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPrecioCombo } from '@prisma/client';

/**
 * DTO para crear un combo directamente
 * El combo se crea como un producto con esCombo=true desde el inicio
 */
export class CreateComboDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'cmik3sg1x0001n701xfj8r4iz',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'ID de la sede (opcional)',
    example: 'sede-id-123',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'ID de la categoría activada para la empresa',
    example: 'empresa-categoria-id-123',
  })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({
    description: 'ID de la marca activada para la empresa',
    example: 'empresa-marca-id-123',
  })
  @IsOptional()
  @IsString()
  empresaMarcaId?: string;

  @ApiProperty({
    description: 'Nombre del combo',
    example: 'COMBO OFICINA COMPLETO',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción del combo',
    example: 'Incluye PC completo + Monitor + Teclado + Mouse',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({
    description: 'Tipo de precio del combo',
    enum: TipoPrecioCombo,
    example: TipoPrecioCombo.CALCULADO,
  })
  @IsEnum(TipoPrecioCombo)
  @IsNotEmpty()
  tipoPrecioCombo: TipoPrecioCombo;

  @ApiPropertyOptional({
    description: 'Porcentaje de descuento (solo para CALCULADO_CON_DESCUENTO)',
    example: 10,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  descuentoPorcentaje?: number;

  @ApiPropertyOptional({
    description: 'Precio fijo del combo (solo para tipo FIJO)',
    example: 2999.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioFijo?: number;

  @ApiPropertyOptional({
    description: 'SKU del combo (opcional)',
    example: 'COMBO-OFICINA-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Código de barras (opcional)',
    example: '7501234567890',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigoBarras?: string;

  @ApiPropertyOptional({
    description: 'Detalles adicionales en formato JSON',
    example: { incluye: 'Setup inicial gratis', garantia: '1 año' },
  })
  @IsOptional()
  detalles?: any;

  @ApiPropertyOptional({
    description: 'Stock mínimo antes de reorden',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stockMinimo?: number;

  @ApiPropertyOptional({
    description: 'URL de video demostrativo',
    example: 'https://youtube.com/watch?v=abc123',
  })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({
    description: 'Porcentaje de impuesto',
    example: 18,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  impuestoPorcentaje?: number;

  @ApiPropertyOptional({
    description: 'Visible en marketplace',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  visibleMarketplace?: boolean;

  @ApiPropertyOptional({
    description: 'Combo destacado',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  destacado?: boolean;

  @ApiPropertyOptional({
    description: 'IDs de archivos/imágenes asociados',
    example: ['archivo-id-1', 'archivo-id-2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagenesIds?: string[];
}
