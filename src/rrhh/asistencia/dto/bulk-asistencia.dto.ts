import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoAsistencia } from '@prisma/client';

export class AsistenciaItemDto {
  @ApiProperty({
    description: 'ID del empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty()
  empleadoId: string;

  @ApiProperty({
    description: 'Estado de asistencia para este empleado',
    enum: EstadoAsistencia,
    example: EstadoAsistencia.PRESENTE,
  })
  @IsEnum(EstadoAsistencia, { message: 'Estado de asistencia inválido' })
  @IsNotEmpty()
  estado: EstadoAsistencia;

  @ApiPropertyOptional({
    description: 'Observaciones',
    example: 'Permiso autorizado',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class BulkAsistenciaDto {
  @ApiProperty({
    description: 'Fecha para todos los registros',
    example: '2026-03-22',
  })
  @IsDateString({}, { message: 'La fecha debe ser una fecha válida (ISO 8601)' })
  @IsNotEmpty()
  fecha: string;

  @ApiProperty({
    description: 'ID de la sede',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({
    description: 'Lista de registros de asistencia',
    type: [AsistenciaItemDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe incluir al menos un registro' })
  @ValidateNested({ each: true })
  @Type(() => AsistenciaItemDto)
  registros: AsistenciaItemDto[];
}
