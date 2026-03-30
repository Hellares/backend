import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { EstadoSuscripcion } from '@prisma/client';

export class AdminEmpresaSuscripcionDto {
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsEnum(EstadoSuscripcion)
  estadoSuscripcion?: EstadoSuscripcion;
}
