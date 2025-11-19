import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsPhoneNumber
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#^()+={}\[\]:;"'<>,.\/\\|~`])[A-Za-z\d@$!%*?&_\-#^()+={}\[\]:;"'<>,.\/\\|~`]{8,}$/, {
    message: 'La contraseña debe contener al menos 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial'
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  nombres: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  apellidos: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  telefono?: string;

  @IsString()
  @IsOptional()
  @MaxLength(8)
  dni?: string;

  @IsOptional()
  @IsPhoneNumber('PE')
  telefonoValidado?: string;

  // Para registro multi-tenant
  @IsString()
  @IsOptional()
  @MaxLength(255)
  subdominioEmpresa?: string; // Si se registra en una empresa específica
}