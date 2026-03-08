import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { TipoCampoServicio, CategoriaCampo } from '@prisma/client';

export class CreateConfiguracionCampoDto {
  @ApiProperty({ description: 'Nombre del campo', example: 'Número de Serie' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @ApiProperty({
    description: 'Tipo de campo',
    enum: TipoCampoServicio,
    example: TipoCampoServicio.TEXTO,
  })
  @IsEnum(TipoCampoServicio)
  tipoCampo: TipoCampoServicio;

  @ApiPropertyOptional({
    description: 'Categoría del campo',
    enum: CategoriaCampo,
    example: CategoriaCampo.EQUIPO_CLIENTE,
  })
  @IsOptional()
  @IsEnum(CategoriaCampo)
  categoria?: CategoriaCampo;

  @ApiPropertyOptional({ description: 'Descripción del campo' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Placeholder del campo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  placeholder?: string;

  @ApiPropertyOptional({
    description: 'Si el campo es requerido',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  esRequerido?: boolean;

  @ApiPropertyOptional({ description: 'Valor por defecto del campo' })
  @IsOptional()
  @IsString()
  defaultValue?: string;

  @ApiPropertyOptional({
    description: 'Opciones para campos de selección o sub-campos para tipo OBJETO',
    example: ['Opción 1', 'Opción 2'],
  })
  @IsOptional()
  @Transform(({ obj }) => obj.opciones, { toClassOnly: true })
  opciones?: any;

  @ApiPropertyOptional({
    description: 'Permite valor "Otro" en campos de selección',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  permiteOtro?: boolean;

  @ApiPropertyOptional({
    description: 'Orden de aparición del campo',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  orden?: number;

  @ApiPropertyOptional({ description: 'ID de la plantilla a la que pertenece' })
  @IsOptional()
  @IsString()
  plantillaId?: string;
}
