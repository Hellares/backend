import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de respuesta para un atributo dentro de una plantilla
 */
export class PlantillaAtributoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  atributoId: string;

  @ApiProperty()
  orden: number;

  @ApiPropertyOptional()
  requeridoOverride?: boolean;

  @ApiPropertyOptional({
    description: 'Override de los valores predefinidos del atributo',
    type: [String],
  })
  valoresOverride?: string[];

  @ApiProperty({
    description: 'Información del atributo',
  })
  atributo: {
    id: string;
    nombre: string;
    clave: string;
    tipo: string;
    requerido: boolean;
    descripcion?: string;
    unidad?: string;
    valores: string[];
  };
}

/**
 * DTO de respuesta para una plantilla de atributos
 */
export class ProductoAtributoPlantillaResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiPropertyOptional()
  categoriaId?: string;

  @ApiProperty()
  nombre: string;

  @ApiPropertyOptional()
  descripcion?: string;

  @ApiPropertyOptional()
  icono?: string;

  @ApiProperty()
  esPredefinida: boolean;

  @ApiProperty()
  orden: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;

  @ApiProperty({
    description: 'Atributos que componen esta plantilla',
    type: [PlantillaAtributoResponseDto],
  })
  atributos: PlantillaAtributoResponseDto[];

  @ApiPropertyOptional({
    description: 'Información de la categoría asociada',
  })
  categoria?: {
    id: string;
    nombreLocal?: string;
    nombrePersonalizado?: string;
  };
}
