import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegistrarSalidaDto {
  @ApiProperty({
    description: 'Hora de salida',
    example: '2026-03-22T17:00:00.000Z',
  })
  @IsDateString({}, { message: 'La hora de salida debe ser una fecha válida (ISO 8601)' })
  @IsNotEmpty()
  horaSalida: string;

  @ApiPropertyOptional({
    description: 'Hora de inicio de almuerzo',
    example: '2026-03-22T12:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La hora de almuerzo inicio debe ser una fecha válida (ISO 8601)' })
  horaAlmuerzoInicio?: string;

  @ApiPropertyOptional({
    description: 'Hora de fin de almuerzo',
    example: '2026-03-22T13:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La hora de almuerzo fin debe ser una fecha válida (ISO 8601)' })
  horaAlmuerzoFin?: string;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales',
    example: 'Salió antes por cita médica',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
