import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiPropertyOptional()
  sedeId?: string;

  @ApiPropertyOptional()
  categoriaId?: string;

  @ApiPropertyOptional()
  marcaId?: string;

  @ApiProperty({
    description: 'Código generado por la empresa',
  })
  codigoEmpresa: string;

  @ApiProperty({
    description: 'Código interno del sistema',
  })
  codigoSistema: string;

  @ApiPropertyOptional()
  sku?: string;

  @ApiPropertyOptional()
  codigoBarras?: string;

  @ApiProperty()
  nombre: string;

  @ApiPropertyOptional()
  descripcion?: string;

  @ApiPropertyOptional()
  detalles?: any;

  @ApiProperty()
  precio: number;

  @ApiPropertyOptional()
  precioCosto?: number;

  @ApiProperty()
  stock: number;

  @ApiPropertyOptional()
  stockMinimo?: number;

  @ApiPropertyOptional()
  peso?: number;

  @ApiPropertyOptional()
  dimensiones?: any;

  @ApiPropertyOptional({
    description: 'URLs de imágenes del producto',
    type: [String],
  })
  imagenes?: string[];

  @ApiPropertyOptional()
  videoUrl?: string;

  @ApiPropertyOptional()
  impuestoPorcentaje?: number;

  @ApiPropertyOptional()
  descuentoMaximo?: number;

  @ApiProperty()
  visibleMarketplace: boolean;

  @ApiProperty()
  destacado: boolean;

  @ApiProperty()
  enOferta: boolean;

  @ApiPropertyOptional()
  precioOferta?: number;

  @ApiPropertyOptional()
  fechaInicioOferta?: Date;

  @ApiPropertyOptional()
  fechaFinOferta?: Date;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;

  // Relaciones opcionales
  @ApiPropertyOptional()
  categoria?: {
    id: string;
    nombre: string;
  };

  @ApiPropertyOptional()
  marca?: {
    id: string;
    nombre: string;
  };

  @ApiPropertyOptional()
  sede?: {
    id: string;
    nombre: string;
  };

  @ApiPropertyOptional({
    description: 'Archivos/imágenes asociados al producto',
    type: [Object],
  })
  archivos?: Array<{
    id: string;
    url: string;
    urlThumbnail?: string;
    categoria: string;
    orden: number;
  }>;
}

export class PaginatedProductoResponseDto {
  @ApiProperty({ type: [ProductoResponseDto] })
  data: ProductoResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
