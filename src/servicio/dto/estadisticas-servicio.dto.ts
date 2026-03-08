import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryEstadisticasDto {
  @ApiPropertyOptional({ description: 'Fecha desde (ISO)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}

export interface EstadisticasServicioResponse {
  totalOrdenes: number;
  ordenesPorEstado: Record<string, number>;
  ordenesPorTipo: Record<string, number>;
  ordenesPorMes: { mes: string; cantidad: number }[];
  tiempoPromedioResolucion: number;
  ingresoTotal: number;
}
