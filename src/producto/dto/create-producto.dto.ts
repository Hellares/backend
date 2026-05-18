import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  IsArray,
  MaxLength,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPrecioCombo } from '@prisma/client';
import { VarianteAtributoDto } from './create-producto-variante.dto';

export class CreateProductoDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'cmik3sg1x0001n701xfj8r4iz',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'IDs de las sedes donde se creará el producto. Si no se proporciona, se asigna a la sede por defecto del usuario',
    example: ['sede-id-123', 'sede-id-456'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sedesIds?: string[];

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
    description: 'ID de la unidad de medida (EmpresaUnidadMedida)',
    example: 'unidad-medida-id-123',
  })
  @IsOptional()
  @IsString()
  unidadMedidaId?: string;

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
    nullable: true,
  })
  @IsOptional()
  @IsString()
  videoUrl?: string | null;

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
    description: 'Tipo de afectación IGV (SUNAT Cat. 07)',
    enum: ['GRAVADO', 'EXONERADO', 'INAFECTO'],
    default: 'GRAVADO',
  })
  @IsOptional()
  @IsEnum(['GRAVADO', 'EXONERADO', 'INAFECTO'])
  tipoAfectacionIgv?: string;

  @ApiPropertyOptional({
    description: 'Aplica ICBPER (bolsa plástica)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  aplicaIcbper?: boolean;

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

  @ApiPropertyOptional({
    description: 'Indica si el producto es un combo',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  esCombo?: boolean;

  @ApiPropertyOptional({
    description:
      'Marca el producto como insumo / materia prima. Insumos están ocultos del POS, marketplace y carrito B2C — solo se usan como componentes en productos compuestos (BOM).',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  esInsumo?: boolean;

  @ApiPropertyOptional({
    description: 'Tipo de precio del combo (solo aplica si esCombo es true)',
    enum: TipoPrecioCombo,
    example: TipoPrecioCombo.FIJO,
  })
  @IsOptional()
  @IsEnum(TipoPrecioCombo)
  tipoPrecioCombo?: TipoPrecioCombo;

  @ApiPropertyOptional({
    description: 'ID de la configuración de precios aplicada',
    example: 'config-precio-id-123',
  })
  @IsOptional()
  @IsString()
  configuracionPrecioId?: string;

  @ApiPropertyOptional({
    description: 'Atributos estructurados del producto base (solo aplica si tieneVariantes es false)',
    example: [
      { atributoId: 'attr-123', valor: 'Negro' },
      { atributoId: 'attr-456', valor: 'XL' },
    ],
    type: [VarianteAtributoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VarianteAtributoDto)
  atributosEstructurados?: VarianteAtributoDto[];
}
