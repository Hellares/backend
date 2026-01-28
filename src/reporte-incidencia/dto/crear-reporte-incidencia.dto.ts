import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsNotEmpty,
  MaxLength,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { TipoReporteIncidencia } from '@prisma/client';

export class CrearReporteIncidenciaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @IsString()
  @IsOptional()
  descripcionGeneral?: string;

  @IsEnum(TipoReporteIncidencia)
  tipoReporte: TipoReporteIncidencia;

  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @IsDateString()
  fechaIncidente: string;

  @IsString()
  @IsOptional()
  supervisorId?: string | null;

  @IsString()
  @IsOptional()
  observacionesFinales?: string;
}
