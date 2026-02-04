import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/utils/pagination.util';

export class ProductoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiPropertyOptional()
  sedeId?: string;

  @ApiPropertyOptional()
  empresaCategoriaId?: string;

  @ApiPropertyOptional()
  empresaMarcaId?: string;

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
  tieneVariantes: boolean;

  @ApiProperty()
  esCombo: boolean;

  @ApiPropertyOptional({
    enum: ['FIJO', 'CALCULADO', 'CALCULADO_CON_DESCUENTO'],
    nullable: true,
  })
  tipoPrecioCombo?: 'FIJO' | 'CALCULADO' | 'CALCULADO_CON_DESCUENTO' | null;

  @ApiPropertyOptional({
    description: 'Cantidad de combos reservados en la sede consultada (solo combos con reservación activa)',
  })
  comboReservado?: number;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;

  // Relaciones opcionales
  @ApiPropertyOptional({
    description: 'Información de la categoría activada',
  })
  categoria?: {
    id: string;
    nombre: string;
    categoriaMaestraId?: string;
    slug?: string;
  };

  @ApiPropertyOptional({
    description: 'Información de la marca activada',
  })
  marca?: {
    id: string;
    nombre: string;
    marcaMaestraId?: string;
    slug?: string;
    logo?: string;
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

  @ApiPropertyOptional({
    description: 'Atributos estructurados del producto base (solo si no tiene variantes)',
    type: [Object],
  })
  atributosValores?: Array<{
    id: string;
    atributoId: string;
    valor: string;
    atributo: {
      id: string;
      nombre: string;
      clave: string;
      tipo: string;
      unidad?: string;
    };
  }>;

  @ApiPropertyOptional({
    description: 'Desglose de stock y precios por sede',
    type: [Object],
  })
  stocksPorSede?: Array<{
    sedeId: string;
    sedeNombre: string;
    sedeCodigo: string;
    cantidad: number;
    stockMinimo?: number;
    stockMaximo?: number;
    ubicacion?: string;
    precio?: number;
    precioCosto?: number;
    precioOferta?: number;
    enOferta: boolean;
    fechaInicioOferta?: Date;
    fechaFinOferta?: Date;
    precioConfigurado: boolean;
  }>;

  @ApiPropertyOptional({
    description: 'Variantes del producto',
    type: [Object],
  })
  variantes?: Array<{
    id: string;
    nombre: string;
    sku: string;
    precio: number;
    stock: number;
    isActive: boolean;
    orden: number;
    atributosValores?: Array<{
      id: string;
      atributoId: string;
      valor: string;
      atributo: {
        id: string;
        nombre: string;
        clave: string;
        tipo: string;
        unidad?: string;
      };
    }>;
  }>;
}

export class PaginatedProductoResponseDto {
  @ApiProperty({ type: [ProductoResponseDto] })
  data: ProductoResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}
