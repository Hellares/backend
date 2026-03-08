import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateConfiguracionCampoDto } from './create-configuracion-campo.dto';

export class CreatePlantillaServicioDto {
  @ApiProperty({ description: 'Nombre de la plantilla', example: 'Reparación de PC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional({ description: 'Descripción de la plantilla' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Campos a crear junto con la plantilla',
    type: [CreateConfiguracionCampoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateConfiguracionCampoDto)
  campos?: CreateConfiguracionCampoDto[];
}
