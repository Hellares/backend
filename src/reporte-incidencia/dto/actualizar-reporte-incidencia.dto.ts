import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { TipoReporteIncidencia, EstadoReporteIncidencia } from '@prisma/client';

export class ActualizarReporteIncidenciaDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  titulo?: string;

  @IsString()
  @IsOptional()
  descripcionGeneral?: string;

  @IsEnum(TipoReporteIncidencia)
  @IsOptional()
  tipoReporte?: TipoReporteIncidencia;

  @IsEnum(EstadoReporteIncidencia)
  @IsOptional()
  estado?: EstadoReporteIncidencia;

  @IsDateString()
  @IsOptional()
  fechaIncidente?: string;

  @IsString()
  @IsOptional()
  supervisorId?: string;

  @IsString()
  @IsOptional()
  observacionesFinales?: string;
}
