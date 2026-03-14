import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoCita } from '@prisma/client';

export class QueryCitaDto {
  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Elementos por página', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Fecha exacta (ISO date)' })
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Fecha desde (ISO date)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO date)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Filtrar por técnico' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado', enum: EstadoCita })
  @IsOptional()
  @IsEnum(EstadoCita)
  estado?: EstadoCita;

  @ApiPropertyOptional({ description: 'Filtrar por servicio' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por cliente persona' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por cliente empresa' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;
}

export class QueryDisponibilidadDto {
  @ApiPropertyOptional({ description: 'Fecha para consultar disponibilidad (ISO date)' })
  @IsDateString()
  fecha: string;

  @ApiPropertyOptional({ description: 'ID de la sede' })
  @IsString()
  sedeId: string;

  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsString()
  servicioId: string;

  @ApiPropertyOptional({ description: 'ID del técnico (opcional, si no se envía retorna para todos)' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;
}

export class QueryTecnicosDisponiblesDto {
  @ApiPropertyOptional({ description: 'Fecha (ISO date)' })
  @IsDateString()
  fecha: string;

  @ApiPropertyOptional({ description: 'Hora de inicio (HH:mm)' })
  @IsString()
  horaInicio: string;

  @ApiPropertyOptional({ description: 'ID de la sede' })
  @IsString()
  sedeId: string;

  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsString()
  servicioId: string;
}
