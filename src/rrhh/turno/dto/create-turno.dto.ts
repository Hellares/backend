import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  Matches,
  Min,
} from 'class-validator';

export class CreateTurnoDto {
  @ApiProperty({ description: 'Nombre del turno', example: 'Turno Ma\u00f1ana' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ description: 'Hora de inicio (HH:mm)', example: '08:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'horaInicio debe tener formato HH:mm (ej: 08:00)',
  })
  horaInicio: string;

  @ApiProperty({ description: 'Hora de fin (HH:mm)', example: '17:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'horaFin debe tener formato HH:mm (ej: 17:00)',
  })
  horaFin: string;

  @ApiProperty({
    description: 'Duraci\u00f3n del almuerzo en minutos',
    example: 60,
    required: false,
    default: 60,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  duracionAlmuerzoMin?: number;

  @ApiProperty({ description: 'Horas efectivas de trabajo', example: 8 })
  @IsNumber()
  @Min(0)
  horasEfectivas: number;

  @ApiProperty({
    description: 'Color para identificar el turno',
    example: '#4CAF50',
    required: false,
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({
    description: 'Turno por defecto',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
