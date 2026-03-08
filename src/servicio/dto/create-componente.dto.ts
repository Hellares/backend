import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { EstadoComponente } from '@prisma/client';

export class CreateComponenteDto {
  @ApiProperty({ description: 'ID del tipo de componente' })
  @IsString()
  @IsNotEmpty()
  tipoComponenteId: string;

  @ApiPropertyOptional({ description: 'Marca del componente' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  marca?: string;

  @ApiPropertyOptional({ description: 'Modelo del componente' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelo?: string;

  @ApiPropertyOptional({ description: 'Número de serie' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSerie?: string;

  @ApiPropertyOptional({
    description: 'Estado del componente',
    enum: EstadoComponente,
    default: 'INGRESADO',
  })
  @IsOptional()
  @IsEnum(EstadoComponente)
  estado?: EstadoComponente;
}
