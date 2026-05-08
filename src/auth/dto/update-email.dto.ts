import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

/// Permite agregar/cambiar el email de la cuenta del usuario autenticado.
/// El email queda con `emailVerificado=false` hasta que el dueño hace clic
/// en el link de verificación enviado a la nueva dirección.
export class UpdateEmailDto {
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  @MaxLength(255)
  email: string;
}
