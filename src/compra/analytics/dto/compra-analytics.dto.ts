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

  @ApiPropertyOptional({
    description:
      'Filtra el reporte de gastos de factura a una sola categoría (para el drill-down desde el gráfico)',
  })
  @IsOptional()
  @IsString()
  categoriaGastoId?: string;

  @ApiPropertyOptional({ enum: PeriodoAgrupacion })
  @IsOptional()
  @IsEnum(PeriodoAgrupacion)
  periodo?: PeriodoAgrupacion;
}
