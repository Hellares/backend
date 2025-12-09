import { IsEmail } from 'class-validator';

  export class CheckAuthMethodsDto {
    @IsEmail({}, { message: 'Email inválido' })
    email: string;
  }