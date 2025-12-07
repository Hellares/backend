import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateEmpresaDto } from './create-empresa.dto';

class CategoriaPersonalizadaDto {
  @ApiPropertyOptional({
    description: 'Nombre de la categoría personalizada',
    example: 'Electrónica Industrial',
  })
  @IsString()
  @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción de la categoría',
    example: 'Equipos y componentes para uso industrial',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  descripcion?: string;
}

class MarcaPersonalizadaDto {
  @ApiPropertyOptional({
    description: 'Nombre de la marca personalizada',
    example: 'Mi Marca Propia',
  })
  @IsString()
  @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción de la marca',
    example: 'Marca de productos propios',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  descripcion?: string;
}

export class CreateEmpresaConCatalogosDto extends CreateEmpresaDto {
  @ApiPropertyOptional({
    description:
      'IDs de categorías maestras a activar. Si no se envía, se usan las recomendadas del rubro.',
    type: [String],
    example: ['cat-id-1', 'cat-id-2', 'cat-id-3'],
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  categoriasMaestrasIds?: string[];

  @ApiPropertyOptional({
    description: 'IDs de marcas maestras a activar. Si no se envía, se usan las recomendadas del rubro.',
    type: [String],
    example: ['marca-id-1', 'marca-id-2'],
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  marcasMaestrasIds?: string[];

  @ApiPropertyOptional({
    description: 'Categorías personalizadas a crear',
    type: [CategoriaPersonalizadaDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CategoriaPersonalizadaDto)
  categoriasPersonalizadas?: CategoriaPersonalizadaDto[];

  @ApiPropertyOptional({
    description: 'Marcas personalizadas a crear',
    type: [MarcaPersonalizadaDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MarcaPersonalizadaDto)
  marcasPersonalizadas?: MarcaPersonalizadaDto[];
}
