import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PeriodoSuscripcion, MetodoPagoSuscripcion } from '@prisma/client';

export class AdminPagoCreateDto {
  @IsNotEmpty()
  @IsString()
  empresaId: string;

  @IsNotEmpty()
  @IsString()
  planSuscripcionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monto: number;

  @IsOptional()
  @IsString()
  moneda?: string = 'PEN';

  @IsEnum(PeriodoSuscripcion)
  periodo: PeriodoSuscripcion;

  @IsOptional()
  @IsEnum(MetodoPagoSuscripcion)
  metodoPago?: MetodoPagoSuscripcion = MetodoPagoSuscripcion.TRANSFERENCIA;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsDateString()
  fechaPago?: string;

  @IsNotEmpty()
  @IsDateString()
  fechaInicio: string;

  @IsNotEmpty()
  @IsDateString()
  fechaFin: string;
}
