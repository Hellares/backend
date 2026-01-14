import {
  IsString,
  IsOptional,
  IsInt,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ActivarMarcaDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'clx123456789',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'ID de la marca maestra a activar',
    example: 'clx987654321',
  })
  @IsOptional()
  @IsString()
  marcaMaestraId?: string;

  @ApiPropertyOptional({
    description:
      'Nombre personalizado (requerido si no se proporciona marcaMaestraId)',
    example: 'Mi Marca Personalizada',
  })
  @ValidateIf((o) => !o.marcaMaestraId)
  @IsString()
  @IsNotEmpty()
  nombrePersonalizado?: string;

  @ApiPropertyOptional({
    description: 'Descripción personalizada de la marca',
    example: 'Marca exclusiva para nuestros productos',
  })
  @IsOptional()
  @IsString()
  descripcionPersonalizada?: string;

  @ApiPropertyOptional({
    description: 'Override del nombre maestro para esta empresa',
    example: 'Apple Store',
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
