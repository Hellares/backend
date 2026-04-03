import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum PeriodoAgrupacion {
  DIARIO = 'DIARIO',
  SEMANAL = 'SEMANAL',
  MENSUAL = 'MENSUAL',
  ANUAL = 'ANUAL',
}

export class VentaAnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'ID de la sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Fecha de inicio del rango' })
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @ApiPropertyOptional({ description: 'Fecha de fin del rango' })
  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @ApiPropertyOptional({ description: 'ID del cliente' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({
    description: 'Periodo de agrupacion',
    enum: PeriodoAgrupacion,
  })
  @IsOptional()
  @IsEnum(PeriodoAgrupacion)
  periodo?: PeriodoAgrupacion;

  // Comparativo: periodos explícitos
  @ApiPropertyOptional({ description: 'Inicio periodo A (comparativo)' })
  @IsOptional()
  @IsString()
  fechaInicioA?: string;

  @ApiPropertyOptional({ description: 'Fin periodo A (comparativo)' })
  @IsOptional()
  @IsString()
  fechaFinA?: string;

  @ApiPropertyOptional({ description: 'Inicio periodo B (comparativo)' })
  @IsOptional()
  @IsString()
  fechaInicioB?: string;

  @ApiPropertyOptional({ description: 'Fin periodo B (comparativo)' })
  @IsOptional()
  @IsString()
  fechaFinB?: string;
}
