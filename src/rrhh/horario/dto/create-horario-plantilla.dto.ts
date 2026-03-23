import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiaSemana } from '@prisma/client';

export class HorarioPlantillaDiaDto {
  @ApiProperty({
    description: 'Día de la semana',
    enum: DiaSemana,
    example: 'LUNES',
  })
  @IsEnum(DiaSemana, {
    message: 'El día de la semana debe ser uno de: LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO',
  })
  diaSemana: DiaSemana;

  @ApiPropertyOptional({
    description: 'ID del turno asignado para este día',
    example: 'clxxxx...',
  })
  @IsOptional()
  @IsString()
  turnoId?: string;

  @ApiPropertyOptional({
    description: 'Indica si este día es de descanso',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  esDescanso?: boolean;

  @ApiPropertyOptional({
    description: 'Hora de inicio personalizada (override del turno)',
    example: '08:00',
  })
  @IsOptional()
  @IsString()
  horaInicioOverride?: string;

  @ApiPropertyOptional({
    description: 'Hora de fin personalizada (override del turno)',
    example: '17:00',
  })
  @IsOptional()
  @IsString()
  horaFinOverride?: string;
}

export class CreateHorarioPlantillaDto {
  @ApiProperty({
    description: 'Nombre de la plantilla de horario',
    example: 'Horario Oficina Estándar',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción de la plantilla',
    example: 'Horario de lunes a viernes, 8am a 5pm',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({
    description: 'Configuración de días de la semana',
    type: [HorarioPlantillaDiaDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HorarioPlantillaDiaDto)
  dias: HorarioPlantillaDiaDto[];
}
