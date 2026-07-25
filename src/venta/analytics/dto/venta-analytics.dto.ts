import { IsOptional, IsString, IsEnum, IsDateString, IsIn, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CanalVenta } from '@prisma/client';

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

  @ApiPropertyOptional({ description: 'ID de la categoria (EmpresaCategoria)' })
  @IsOptional()
  @IsString()
  categoriaId?: string;

  @ApiPropertyOptional({ description: 'Canal de venta', enum: CanalVenta })
  @IsOptional()
  @IsEnum(CanalVenta)
  canalVenta?: CanalVenta;

  @ApiPropertyOptional({ description: "Filtrar por envio: 'true' (con envio) | 'false' (venta fisica)" })
  @IsOptional()
  @IsIn(['true', 'false'])
  conEnvio?: string;

  @ApiPropertyOptional({ description: 'Orden del ranking: DESC = mas vendidos (default), ASC = menos vendidos' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  orden?: 'ASC' | 'DESC';

  @ApiPropertyOptional({ description: 'Criterio de orden: INGRESO (default) | CANTIDAD' })
  @IsOptional()
  @IsIn(['INGRESO', 'CANTIDAD'])
  ordenarPor?: 'INGRESO' | 'CANTIDAD';

  @ApiPropertyOptional({ description: 'Maximo de filas del ranking (1-100, default 10)' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

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
