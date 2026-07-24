import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/** Registro público de repartidor freelance (crea cuenta si no existe). */
export class RegistroRepartidorDto {
  /** DNI (8) — se valida contra RENIEC, el nombre queda el oficial. */
  @IsString()
  @Matches(/^\d{8}$/, { message: 'DNI debe tener 8 dígitos' })
  dni: string;

  /** Celular peruano (9 dígitos, empieza en 9) — se verificará por OTP. */
  @IsString()
  @Matches(/^9\d{8}$/, { message: 'Celular inválido (9 dígitos)' })
  celular: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  zonas: string[];

  @IsOptional()
  @IsString()
  placaVehiculo?: string;
}

/** Actualización del perfil (mientras espera aprobación o después). */
export class ActualizarPerfilRepartidorDto {
  @IsOptional()
  @IsString()
  fotoUrl?: string;

  @IsOptional()
  @IsString()
  placaVehiculo?: string;

  @IsOptional()
  @IsString()
  antecedentesUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  zonas?: string[];
}

export class VerificarOtpDto {
  @IsString()
  @Length(6, 6)
  codigo: string;
}

export class ResolverAprobacionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  motivo?: string;
}
