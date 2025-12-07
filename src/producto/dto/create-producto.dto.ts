import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
  IsDateString,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductoDto {
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
    description: 'ID de la categoría activada para la empresa (EmpresaCategoria)',
    example: 'empresa-categoria-id-123',
  })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({
    description: 'ID de la marca activada para la empresa (EmpresaMarca)',
    example: 'empresa-marca-id-123',
  })
  @IsOptional()
  @IsString()
  empresaMarcaId?: string;

  @ApiPropertyOptional({
    description: 'SKU del producto',
    example: 'SKU-12345',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Código de barras',
    example: '7501234567890',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigoBarras?: string;

  @ApiProperty({
    description: 'Nombre del producto',
    example: 'Laptop HP Pavilion 15',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción del producto',
    example: 'Laptop con procesador Intel i7, 16GB RAM, 512GB SSD',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Detalles adicionales en formato JSON',
    example: { color: 'plata', garantia: '1 año' },
  })
  @IsOptional()
  detalles?: any;

  @ApiProperty({
    description: 'Precio de venta',
    example: 2999.99,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precio: number;

  @ApiPropertyOptional({
    description: 'Precio de costo',
    example: 2200.00,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioCosto?: number;

  @ApiPropertyOptional({
    description: 'Stock disponible',
    example: 50,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stock?: number;

  @ApiPropertyOptional({
    description: 'Stock mínimo antes de reorden',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stockMinimo?: number;

  @ApiPropertyOptional({
    description: 'Peso en kilogramos',
    example: 2.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  peso?: number;

  @ApiPropertyOptional({
    description: 'Dimensiones del producto',
    example: { largo: 35, ancho: 24, alto: 2 },
  })
  @IsOptional()
  dimensiones?: any;

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
    description: 'Descuento máximo permitido (%)',
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoMaximo?: number;

  @ApiPropertyOptional({
    description: 'Visible en marketplace',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  visibleMarketplace?: boolean;

  @ApiPropertyOptional({
    description: 'Producto destacado',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  destacado?: boolean;

  @ApiPropertyOptional({
    description: 'Producto en oferta',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enOferta?: boolean;

  @ApiPropertyOptional({
    description: 'Precio de oferta',
    example: 2499.99,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioOferta?: number;

  @ApiPropertyOptional({
    description: 'Fecha de inicio de la oferta',
    example: '2025-12-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  fechaInicioOferta?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin de la oferta',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  fechaFinOferta?: string;

  @ApiPropertyOptional({
    description: 'IDs de archivos/imágenes asociados',
    example: ['archivo-id-1', 'archivo-id-2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagenesIds?: string[];

  @ApiPropertyOptional({
    description: 'Indica si el producto tiene variantes',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  tieneVariantes?: boolean;
}
