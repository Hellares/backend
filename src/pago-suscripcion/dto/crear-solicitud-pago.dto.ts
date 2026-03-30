import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { PeriodoSuscripcion, MetodoPagoSuscripcion } from '@prisma/client';

export class CrearSolicitudPagoDto {
  @IsNotEmpty()
  @IsString()
  planSuscripcionId: string;

  @IsEnum(PeriodoSuscripcion)
  periodo: PeriodoSuscripcion;

  @IsOptional()
  @IsEnum(MetodoPagoSuscripcion)
  metodoPago?: MetodoPagoSuscripcion;
}
