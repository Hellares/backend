import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Parentesco {
  CONYUGE = 'CONYUGE',
  HIJO = 'HIJO',
  HIJA = 'HIJA',
  PADRE = 'PADRE',
  MADRE = 'MADRE',
  HERMANO = 'HERMANO',
  HERMANA = 'HERMANA',
  ABUELO = 'ABUELO',
  ABUELA = 'ABUELA',
  NIETO = 'NIETO',
  NIETA = 'NIETA',
  TIO = 'TIO',
  TIA = 'TIA',
  SOBRINO = 'SOBRINO',
  SOBRINA = 'SOBRINA',
  PRIMO = 'PRIMO',
  PRIMA = 'PRIMA',
}

export class AgregarFamiliarDto {
  @ApiProperty({
    description: 'ID del usuario familiar',
    example: 'user-familiar-123',
  })
  @IsString()
  @IsNotEmpty()
  familiarId: string;

  @ApiProperty({
    description: 'ID de la política de descuento para familiares',
    example: 'politica-familiares-123',
  })
  @IsString()
  @IsNotEmpty()
  politicaId: string;

  @ApiProperty({
    description: 'Parentesco con el trabajador',
    enum: Parentesco,
    example: Parentesco.CONYUGE,
  })
  @IsEnum(Parentesco)
  @IsNotEmpty()
  parentesco: Parentesco;

  @ApiPropertyOptional({
    description: 'Path al documento que verifica el parentesco',
    example: '/uploads/documentos/acta-matrimonio-123.pdf',
  })
  @IsString()
  @IsOptional()
  documentoVerificacion?: string;

  @ApiPropertyOptional({
    description: 'Límite mensual de usos para este familiar',
    example: 3,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limiteMensualUsos?: number;
}
