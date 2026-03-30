import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { PeriodoSuscripcion } from '@prisma/client';

export class AdminEmpresaPlanDto {
  @IsNotEmpty()
  @IsString()
  planId: string;

  @IsOptional()
  @IsEnum(PeriodoSuscripcion)
  periodo?: PeriodoSuscripcion = PeriodoSuscripcion.MENSUAL;
}
