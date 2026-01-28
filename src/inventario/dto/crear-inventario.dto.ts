import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsNotEmpty,
  MaxLength,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { TipoInventario } from '@prisma/client';

export class CrearInventarioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsEnum(TipoInventario)
  tipoInventario: TipoInventario;

  @IsUUID()
  @IsNotEmpty()
  sedeId: string;

  @IsDateString()
  fechaPlanificada: string;

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
}
