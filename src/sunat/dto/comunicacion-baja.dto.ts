import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  MinLength,
  MaxLength,
  IsDateString,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearComunicacionBajaDetalleDto {
  @ApiProperty({ description: 'ID del ComprobanteElectronico a anular' })
  @IsString()
  @IsNotEmpty()
  comprobanteId: string;

  @ApiProperty({ description: 'Motivo específico del documento (max 250 chars)' })
  @IsString()
  @MinLength(3)
  @MaxLength(250)
  motivoEspecifico: string;
}

export class CrearComunicacionBajaDto {
  @ApiProperty({ description: 'ID de la sede emisora' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({
    description: 'Fecha de los documentos a anular (YYYY-MM-DD). Max 7 días atrás.',
  })
  @IsDateString()
  fechaReferencia: string;

  @ApiProperty({ description: 'Motivo general de la comunicación (max 500 chars)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivoBaja: string;

  @ApiProperty({
    description: 'Documentos a anular (1 a 100)',
    type: [CrearComunicacionBajaDetalleDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrearComunicacionBajaDetalleDto)
  detalles: CrearComunicacionBajaDetalleDto[];

  @ApiPropertyOptional({ description: 'Identificador del usuario/sistema que origina la baja' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  usuarioCreacion?: string;
}
