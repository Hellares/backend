import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  // Multi-tenant: opcional. Si se envía, identifica la empresa para
  // personalizar el correo (logo, colores). Sin él, va el branding default.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subdominioEmpresa?: string;
}
