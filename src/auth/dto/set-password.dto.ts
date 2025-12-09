import { IsString, MinLength, Matches } from 'class-validator';

  export class SetPasswordDto {
    @IsString()
    @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#^()+={}\[\]:;"'<>,.\/\\|~`])/, {
      message: 'La contraseña debe contener al menos una mayúscula, una minúscula, un número y un carácter especial',
    })
    password: string;
  }