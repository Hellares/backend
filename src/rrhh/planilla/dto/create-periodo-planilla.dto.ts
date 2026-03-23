import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreatePeriodoPlanillaDto {
  @ApiProperty({
    description: 'Periodo en formato YYYY-MM',
    example: '2026-03',
  })
  @IsNotEmpty({ message: 'El periodo es requerido' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El periodo debe tener formato YYYY-MM (ej: 2026-03)',
  })
  periodo: string;

  @ApiPropertyOptional({
    description: 'ID de sede (null = todas las sedes)',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Observaciones del periodo',
    example: 'Planilla marzo 2026',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
