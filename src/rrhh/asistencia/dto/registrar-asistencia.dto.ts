import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { TipoAsistencia, EstadoAsistencia } from '@prisma/client';

export class RegistrarAsistenciaDto {
  @ApiProperty({
    description: 'ID del empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty()
  empleadoId: string;

  @ApiProperty({
    description: 'Fecha de la asistencia',
    example: '2026-03-22',
  })
  @IsDateString({}, { message: 'La fecha debe ser una fecha válida (ISO 8601)' })
  @IsNotEmpty()
  fecha: string;

  @ApiPropertyOptional({
    description: 'Hora de entrada',
    example: '2026-03-22T08:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La hora de entrada debe ser una fecha válida (ISO 8601)' })
  horaEntrada?: string;

  @ApiPropertyOptional({
    description: 'Tipo de asistencia',
    enum: TipoAsistencia,
    default: TipoAsistencia.NORMAL,
  })
  @IsOptional()
  @IsEnum(TipoAsistencia, { message: 'Tipo de asistencia inválido' })
  tipoAsistencia?: TipoAsistencia = TipoAsistencia.NORMAL;

  @ApiProperty({
    description: 'Estado de la asistencia',
    enum: EstadoAsistencia,
    example: EstadoAsistencia.PRESENTE,
  })
  @IsEnum(EstadoAsistencia, { message: 'Estado de asistencia inválido' })
  @IsNotEmpty()
  estado: EstadoAsistencia;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales',
    example: 'Llegó 5 minutos tarde por tráfico',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
