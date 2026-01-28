import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  IsDateString,
} from 'class-validator';

export class RegistrarConteoDto {
  @IsInt()
  @Min(0)
  cantidadContada: number;

  @IsString()
  @IsOptional()
  ubicacionFisica?: string;

  @IsString()
  @IsOptional()
  loteNumero?: string;

  @IsDateString()
  @IsOptional()
  fechaVencimiento?: string;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  fotoEvidenciaUrl?: string;
}
