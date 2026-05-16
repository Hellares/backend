import { ApiProperty } from '@nestjs/swagger';
import { FrecuenciaGasto } from '@prisma/client';
import {
  IsString,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class ActualizarGastoRecurrenteDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoriaGastoId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sedeId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  proveedorId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoEstimado?: number;

  @ApiProperty({ required: false, enum: FrecuenciaGasto })
  @IsOptional()
  @IsEnum(FrecuenciaGasto)
  frecuencia?: FrecuenciaGasto;

  @ApiProperty({ required: false, minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  diaVencimiento?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string | null;
}
