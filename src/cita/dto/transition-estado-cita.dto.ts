import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  IsDateString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoCita } from '@prisma/client';

export class SiguienteCitaInput {
  @ApiProperty({ description: 'Fecha (ISO date)', example: '2026-04-01' })
  @IsDateString()
  fecha: string;

  @ApiProperty({ description: 'Hora inicio (HH:mm)', example: '09:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  horaInicio: string;

  @ApiProperty({ description: 'Hora fin (HH:mm)', example: '09:30' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  horaFin: string;

  @ApiPropertyOptional({ description: 'ID del técnico (si no se envía, usa el mismo)' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'Notas para la siguiente cita' })
  @IsOptional()
  @IsString()
  notas?: string;
}

export class TransitionEstadoCitaDto {
  @ApiProperty({ description: 'Nuevo estado de la cita', enum: EstadoCita })
  @IsEnum(EstadoCita)
  nuevoEstado: EstadoCita;

  @ApiPropertyOptional({ description: 'Notas sobre la transición' })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({ description: 'Motivo de cancelación (requerido si estado=CANCELADA)' })
  @IsOptional()
  @IsString()
  motivoCancelacion?: string;

  @ApiPropertyOptional({ description: 'Generar orden de servicio al completar', default: false })
  @IsOptional()
  @IsBoolean()
  generarOrden?: boolean;

  @ApiPropertyOptional({ description: 'Programar siguiente cita al completar' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SiguienteCitaInput)
  siguienteCita?: SiguienteCitaInput;
}
