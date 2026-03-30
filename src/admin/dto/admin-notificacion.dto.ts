import { IsNotEmpty, IsString, IsOptional, IsEnum, IsArray, MaxLength, MinLength } from 'class-validator';
import { TipoNotificacion } from '@prisma/client';

export class AdminEnviarNotificacionDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  titulo: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  mensaje: string;

  @IsOptional()
  @IsEnum(TipoNotificacion)
  tipo?: TipoNotificacion = TipoNotificacion.SISTEMA;
}

export class AdminEnviarUsuariosDto extends AdminEnviarNotificacionDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  usuarioIds: string[];
}
