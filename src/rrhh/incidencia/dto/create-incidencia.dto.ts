import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { TipoIncidencia } from '@prisma/client';

export class CreateIncidenciaDto {
  @ApiProperty({
    description: 'ID del empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty()
  empleadoId: string;

  @ApiProperty({
    description: 'Tipo de incidencia',
    enum: TipoIncidencia,
    example: TipoIncidencia.VACACION,
  })
  @IsEnum(TipoIncidencia, { message: 'Tipo de incidencia inválido' })
  @IsNotEmpty()
  tipo: TipoIncidencia;

  @ApiProperty({
    description: 'Fecha de inicio',
    example: '2026-03-25',
  })
  @IsDateString({}, { message: 'La fecha de inicio debe ser una fecha válida (ISO 8601)' })
  @IsNotEmpty()
  fechaInicio: string;

  @ApiProperty({
    description: 'Fecha de fin',
    example: '2026-03-28',
  })
  @IsDateString({}, { message: 'La fecha de fin debe ser una fecha válida (ISO 8601)' })
  @IsNotEmpty()
  fechaFin: string;

  @ApiPropertyOptional({
    description: 'Motivo de la incidencia',
    example: 'Vacaciones programadas',
  })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({
    description: 'URL del documento adjunto',
    example: 'https://storage.example.com/docs/certificado-medico.pdf',
  })
  @IsOptional()
  @IsString()
  documentoAdjunto?: string;
}
