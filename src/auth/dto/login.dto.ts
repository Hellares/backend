import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsEnum,
  IsIn
} from 'class-validator';
import { Rol } from '@prisma/client';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;

  // Para login multi-tenant
  @IsString()
  @IsOptional()
  @MaxLength(255)
  subdominioEmpresa?: string; // Para identificar la empresa

  // Para seleccionar un rol específico cuando el usuario tiene múltiples roles en una empresa
  @IsEnum(Rol)
  @IsOptional()
  rol?: Rol; // Rol específico a usar en esta sesión

  // Modo de login: marketplace (sin tenant) o management (con tenant)
  @IsString()
  @IsOptional()
  @IsIn(['marketplace', 'management'])
  loginMode?: 'marketplace' | 'management';
}