import { IsOptional, IsArray, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BulkUploadProductoDto {
  @ApiPropertyOptional({ description: 'IDs de sedes donde crear stock inicial', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sedesIds?: string[];
}

export interface RowError {
  fila: number;
  columna: string;
  valor: any;
  mensaje: string;
}

export interface BulkUploadResult {
  totalFilas: number;
  creados: number;
  errores: number;
  detalleErrores: RowError[];
  productosCreados: { id: string; nombre: string; codigoEmpresa: string }[];
}
