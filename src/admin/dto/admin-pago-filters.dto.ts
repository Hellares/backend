import { IsOptional, IsString, IsEnum, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoPagoSuscripcion, MetodoPagoSuscripcion } from '@prisma/client';

export class AdminPagoFiltersDto {
  @IsOptional()
  @IsString()
  empresaId?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(EstadoPagoSuscripcion)
  estado?: EstadoPagoSuscripcion;

  @IsOptional()
  @IsEnum(MetodoPagoSuscripcion)
  metodoPago?: MetodoPagoSuscripcion;

  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
