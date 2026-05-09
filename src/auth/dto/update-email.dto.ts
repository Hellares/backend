import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/// Permite agregar/cambiar el email de la cuenta del usuario autenticado.
/// El email queda con `emailVerificado=false` hasta que el dueño hace clic
/// en el link de verificación enviado a la nueva dirección.
///
/// `currentPassword` es opcional a nivel de DTO porque cuentas Google-only
/// y DNI-only sin password no pueden enviarla. El service decide si la
/// exige según el estado del usuario (passwordHash != null → exigida).
export class UpdateEmailDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;
}
