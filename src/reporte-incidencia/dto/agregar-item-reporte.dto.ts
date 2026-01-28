import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsPositive,
  IsNotEmpty,
  IsUUID,
  Min,
} from 'class-validator';
import { TipoIncidenciaProducto } from '@prisma/client';

export class AgregarItemReporteDto {
  @IsString()
  @IsNotEmpty()
  productoStockId: string;

  @IsEnum(TipoIncidenciaProducto)
  tipo: TipoIncidenciaProducto;

  @IsInt()
  @IsPositive()
  @Min(1)
  cantidadAfectada: number;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsString()
  @IsOptional()
  observaciones?: string;
}
