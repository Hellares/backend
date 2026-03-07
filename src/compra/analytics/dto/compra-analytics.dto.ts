import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum PeriodoAgrupacion {
  DIARIO = 'diario',
  SEMANAL = 'semanal',
  MENSUAL = 'mensual',
  ANUAL = 'anual',
}

export class CompraAnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaFin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ enum: PeriodoAgrupacion })
  @IsOptional()
  @IsEnum(PeriodoAgrupacion)
  periodo?: PeriodoAgrupacion;
}
