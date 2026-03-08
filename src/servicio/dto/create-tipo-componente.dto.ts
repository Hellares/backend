import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { CategoriaComponente } from '@prisma/client';

export class CreateTipoComponenteDto {
  @ApiProperty({ description: 'Nombre del tipo de componente' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @ApiProperty({
    description: 'Categoría del componente',
    enum: CategoriaComponente,
  })
  @IsEnum(CategoriaComponente)
  categoria: CategoriaComponente;

  @ApiPropertyOptional({ description: 'Descripción' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}
