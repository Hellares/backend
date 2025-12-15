import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsPhoneNumber,
  ValidateIf,
  IsBoolean
} from 'class-validator';

export class RegisterDto {
  // Email es opcional - se requiere solo si no es cliente sin email
  @ValidateIf(o => o.email !== undefined && o.email !== null && o.email !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // Password opcional - se puede generar automáticamente desde DNI para clientes
  @IsString()
  @IsOptional()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#^()+={}\[\]:;"'<>,.\/\\|~`])[A-Za-z\d@$!%*?&_\-#^()+={}\[\]:;"'<>,.\/\\|~`]{8,}$/, {
    message: 'La contraseña debe contener al menos 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial'
  })
  password?: string;

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

  // DNI requerido cuando no hay email
  @ValidateIf(o => !o.email || o.email === '')
  @IsString()
  @IsNotEmpty({ message: 'DNI es requerido cuando no se proporciona email' })
  @MaxLength(8)
  @Matches(/^\d{8}$/, { message: 'DNI debe tener 8 dígitos' })
  dni?: string;

  @IsOptional()
  @IsPhoneNumber('PE')
  telefonoValidado?: string;

  // Indica si es un registro de cliente sin email (se usará DNI como credencial)
  @IsBoolean()
  @IsOptional()
  esClienteSinEmail?: boolean;

  // Para registro multi-tenant
  @IsString()
  @IsOptional()
  @MaxLength(255)
  subdominioEmpresa?: string; // Si se registra en una empresa específica
}