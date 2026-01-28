import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { TipoInventario, EstadoInventario } from '@prisma/client';

export class ActualizarInventarioDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsEnum(TipoInventario)
  @IsOptional()
  tipoInventario?: TipoInventario;

  @IsEnum(EstadoInventario)
  @IsOptional()
  estado?: EstadoInventario;

  @IsDateString()
  @IsOptional()
  fechaPlanificada?: string;

  @IsUUID()
  @IsOptional()
  supervisorId?: string;

  @IsBoolean()
  @IsOptional()
  incluirTodosProductos?: boolean;

  @IsBoolean()
  @IsOptional()
  permitirAjusteAutomatico?: boolean;

  @IsBoolean()
  @IsOptional()
  generarReporteIncidencias?: boolean;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  observacionesFinales?: string;
}
