import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum TipoCategoriaGasto {
  INGRESO = 'INGRESO',
  EGRESO = 'EGRESO',
}

export class CrearCategoriaGastoDto {
  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiProperty({ enum: TipoCategoriaGasto })
  @IsEnum(TipoCategoriaGasto)
  tipo: TipoCategoriaGasto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  icono?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  color?: string;
}

export class ActualizarCategoriaGastoDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiProperty({ required: false, enum: TipoCategoriaGasto })
  @IsOptional()
  @IsEnum(TipoCategoriaGasto)
  tipo?: TipoCategoriaGasto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  icono?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  color?: string;
}
