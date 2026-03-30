import { IsOptional, IsEnum, IsBoolean, IsString } from 'class-validator';
import { EstadoSuscripcion } from '@prisma/client';

export class AdminEmpresaUpdateDto {
  @IsOptional()
  @IsEnum(EstadoSuscripcion)
  estadoSuscripcion?: EstadoSuscripcion;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  motivo?: string;
}
