import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsBoolean, IsEnum } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum OrdenProducto {
  NOMBRE_ASC = 'nombre_asc',
  NOMBRE_DESC = 'nombre_desc',
  PRECIO_ASC = 'precio_asc',
  PRECIO_DESC = 'precio_desc',
  STOCK_ASC = 'stock_asc',
  STOCK_DESC = 'stock_desc',
  RECIENTES = 'recientes',
  ANTIGUOS = 'antiguos',
}

export class QueryProductoDto {
  @ApiPropertyOptional({
    description: 'Página actual',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Búsqueda por nombre, descripción o código',
    example: 'laptop',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por categoría activada de la empresa (EmpresaCategoria)',
    example: 'empresa-categoria-id-123',
  })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por marca activada de la empresa (EmpresaMarca)',
    example: 'empresa-marca-id-123',
  })
  @IsOptional()
  @IsString()
  empresaMarcaId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por sede',
    example: 'sede-id-123',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Mostrar todos los productos, incluso si no tienen stock en la sede seleccionada (por defecto: false)',
    example: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  mostrarTodos?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar solo productos visibles en marketplace',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  visibleMarketplace?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar solo productos destacados',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  destacado?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar solo productos con stock bajo',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  stockBajo?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar solo productos simples (excluye combos)',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  soloProductos?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar solo combos/kits',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  soloCombos?: boolean;

  @ApiPropertyOptional({
    description: 'Ordenamiento',
    enum: OrdenProducto,
    example: OrdenProducto.NOMBRE_ASC,
  })
  @IsOptional()
  @IsEnum(OrdenProducto)
  orden?: OrdenProducto;
}
