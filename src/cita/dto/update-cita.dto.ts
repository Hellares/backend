import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString, Matches } from 'class-validator';

export class UpdateCitaDto {
  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiPropertyOptional({ description: 'ID del técnico asignado' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente persona' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente empresa' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'Fecha de la cita (ISO date)' })
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Hora de inicio (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaInicio debe tener formato HH:mm' })
  horaInicio?: string;

  @ApiPropertyOptional({ description: 'Hora de fin (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaFin debe tener formato HH:mm' })
  horaFin?: string;

  @ApiPropertyOptional({ description: 'Notas adicionales' })
  @IsOptional()
  @IsString()
  notas?: string;
}
