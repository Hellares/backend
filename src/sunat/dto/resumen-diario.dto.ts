import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearResumenDiarioDetalleDto {
  @ApiProperty({ description: 'ID del ComprobanteElectronico (BOLETA) a anular' })
  @IsString()
  @IsNotEmpty()
  comprobanteId: string;

  @ApiProperty({ description: 'Motivo específico del documento (max 250 chars)' })
  @IsString()
  @MinLength(3)
  @MaxLength(250)
  motivoEspecifico: string;
}

export class CrearResumenDiarioDto {
  @ApiProperty({ description: 'ID de la sede emisora' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'Motivo general de la anulación (max 500 chars)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivoAnulacion: string;

  @ApiProperty({
    description:
      'Boletas a anular (1 a 100). Todas deben compartir fechaEmision (regla SUNAT).',
    type: [CrearResumenDiarioDetalleDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrearResumenDiarioDetalleDto)
  detalles: CrearResumenDiarioDetalleDto[];

  @ApiPropertyOptional({ description: 'Identificador del usuario que origina el RC' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  usuarioCreacion?: string;
}
