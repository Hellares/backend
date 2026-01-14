import {
  IsString,
  IsOptional,
  IsInt,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ActivarUnidadMedidaDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'clx123456789',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'ID de la unidad maestra SUNAT a activar',
    example: 'clx987654321',
  })
  @IsOptional()
  @IsString()
  unidadMaestraId?: string;

  @ApiPropertyOptional({
    description:
      'Nombre personalizado (requerido si no se proporciona unidadMaestraId)',
    example: 'Caja de 12 unidades',
  })
  @ValidateIf((o) => !o.unidadMaestraId)
  @IsString()
  @IsNotEmpty()
  nombrePersonalizado?: string;

  @ApiPropertyOptional({
    description:
      'Símbolo personalizado (requerido si no se proporciona unidadMaestraId)',
    example: 'cja12',
  })
  @ValidateIf((o) => !o.unidadMaestraId)
  @IsString()
  @IsNotEmpty()
  simboloPersonalizado?: string;

  @ApiPropertyOptional({
    description: 'Código personalizado opcional',
    example: 'CJ12',
  })
  @IsOptional()
  @IsString()
  codigoPersonalizado?: string;

  @ApiPropertyOptional({
    description: 'Descripción de la unidad',
    example: 'Caja con 12 unidades de producto',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Override del nombre maestro para esta empresa',
    example: 'Kilo',
  })
  @IsOptional()
  @IsString()
  nombreLocal?: string;

  @ApiPropertyOptional({
    description: 'Override del símbolo maestro para esta empresa',
    example: 'k',
  })
  @IsOptional()
  @IsString()
  simboloLocal?: string;

  @ApiPropertyOptional({
    description: 'Orden de visualización en listas',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  orden?: number;
}
