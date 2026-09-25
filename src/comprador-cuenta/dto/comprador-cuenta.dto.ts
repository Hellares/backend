import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class DniCompradorDto {
  @ApiProperty({ example: '44885296' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'El DNI debe tener 8 dígitos' })
  dni: string;
}

export class EnviarCodigoCompradorDto extends DniCompradorDto {
  @ApiPropertyOptional({ description: 'Solo para un DNI nuevo: el celular al que va el código', example: '987654321' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  celular?: string;
}

export class ConfirmarCompradorDto extends DniCompradorDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos' })
  codigo: string;

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ description: 'Solo si RENIEC no respondió' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombres?: string;

  @ApiPropertyOptional({ description: 'Solo si RENIEC no respondió' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidos?: string;

  // Un texto opcional puede llegar VACÍO en vez de undefined.
  @ApiPropertyOptional()
  @ValidateIf((o) => o.email !== undefined && o.email !== null && o.email !== '')
  @IsEmail({}, { message: 'Correo inválido' })
  @MaxLength(255)
  email?: string;
}
