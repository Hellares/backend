import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { EstadoCita } from '@prisma/client';

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
}
