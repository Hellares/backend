import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  Matches,
} from 'class-validator';

export class CreateCitaDto {
  // Set by controller from x-tenant-id
  empresaId: string;

  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  sedeId: string;

  @ApiProperty({ description: 'ID del servicio' })
  @IsString()
  servicioId: string;

  @ApiProperty({ description: 'ID del técnico asignado' })
  @IsString()
  tecnicoId: string;

  @ApiPropertyOptional({ description: 'ID del cliente persona (EmpresaPersona)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente empresa (ClienteEmpresa)' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiProperty({ description: 'Fecha de la cita (ISO date)', example: '2026-03-20' })
  @IsDateString()
  fecha: string;

  @ApiProperty({ description: 'Hora de inicio (HH:mm)', example: '09:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaInicio debe tener formato HH:mm' })
  horaInicio: string;

  @ApiProperty({ description: 'Hora de fin (HH:mm)', example: '10:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaFin debe tener formato HH:mm' })
  horaFin: string;

  @ApiPropertyOptional({ description: 'Notas adicionales' })
  @IsOptional()
  @IsString()
  notas?: string;

  // Set by controller from JWT
  creadoPor?: string;
}
