import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para definir un atributo dentro de una plantilla
 */
export class PlantillaAtributoDto {
  @ApiProperty({ description: 'ID del atributo existente' })
  @IsString()
  atributoId: string;

  @ApiPropertyOptional({ description: 'Orden del atributo en la plantilla' })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @ApiPropertyOptional({
    description: 'Override del campo requerido (opcional)',
  })
  @IsOptional()
  @IsBoolean()
  requeridoOverride?: boolean;

  @ApiPropertyOptional({
    description:
      'Override de los valores predefinidos del atributo (opcional). ' +
      'Permite personalizar los valores disponibles para este atributo ' +
      'específicamente en esta plantilla.',
    example: ['NVMe', 'SSD', 'HDD'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  valoresOverride?: string[];
}

/**
 * DTO para crear una plantilla de atributos
 */
export class CreateProductoAtributoPlantillaDto {
  @ApiProperty({
    description: 'Nombre de la plantilla',
    example: 'Motherboard',
  })
  @IsString()
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción de la plantilla',
    example: 'Atributos estándar para placas madre',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Icono de la plantilla (emoji o nombre)',
    example: '🔌',
  })
  @IsOptional()
  @IsString()
  icono?: string;

  @ApiPropertyOptional({
    description: 'ID de categoría asociada (opcional)',
  })
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional({
    description: 'Orden de visualización',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @ApiProperty({
    description: 'Lista de atributos que componen la plantilla',
    type: [PlantillaAtributoDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'La plantilla debe tener al menos un atributo' })
  @ValidateNested({ each: true })
  @Type(() => PlantillaAtributoDto)
  atributos: PlantillaAtributoDto[];
}
