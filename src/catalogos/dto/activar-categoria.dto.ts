import {
  IsString,
  IsOptional,
  IsInt,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ActivarCategoriaDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'clx123456789',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'ID de la categoría maestra a activar',
    example: 'clx987654321',
  })
  @IsOptional()
  @IsString()
  categoriaMaestraId?: string;

  @ApiPropertyOptional({
    description:
      'Nombre personalizado (requerido si no se proporciona categoriaMaestraId)',
    example: 'Productos Especiales',
  })
  @ValidateIf((o) => !o.categoriaMaestraId)
  @IsString()
  @IsNotEmpty()
  nombrePersonalizado?: string;

  @ApiPropertyOptional({
    description: 'Descripción personalizada de la categoría',
    example: 'Categoría para productos especiales de temporada',
  })
  @IsOptional()
  @IsString()
  descripcionPersonalizada?: string;

  @ApiPropertyOptional({
    description: 'Override del nombre maestro para esta empresa',
    example: 'Tech',
  })
  @IsOptional()
  @IsString()
  nombreLocal?: string;

  @ApiPropertyOptional({
    description: 'Orden de visualización en listas',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  orden?: number;
}
