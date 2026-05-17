import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum CampoPrecio {
  PRECIO = 'PRECIO',
  COSTO = 'COSTO',
  OFERTA = 'OFERTA',
  LIQUIDACION = 'LIQUIDACION',
}

export enum ModoVerificacion {
  RANGO = 'RANGO',
  EXACTO = 'EXACTO',
  SIN_VALOR = 'SIN_VALOR',
}

export enum FiltroStock {
  CON = 'CON',
  SIN = 'SIN',
  AMBOS = 'AMBOS',
}

/**
 * Query DTO para el endpoint de auditoría/verificación de precios.
 * Pensado para localizar productos con precios mal cargados (ej. costo
 * S/100 que debió ser S/10) sin tener que recorrer el catálogo completo.
 */
export class VerificarPreciosDto {
  @ApiPropertyOptional({ description: 'ID de sede; sin valor = todas las sedes' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Campo a auditar',
    enum: CampoPrecio,
    default: CampoPrecio.COSTO,
  })
  @IsOptional()
  @IsEnum(CampoPrecio)
  campo?: CampoPrecio = CampoPrecio.COSTO;

  @ApiPropertyOptional({
    description: 'Modo: RANGO (min/max), EXACTO o SIN_VALOR (campo null)',
    enum: ModoVerificacion,
    default: ModoVerificacion.RANGO,
  })
  @IsOptional()
  @IsEnum(ModoVerificacion)
  modo?: ModoVerificacion = ModoVerificacion.RANGO;

  @ApiPropertyOptional({ description: 'Valor mínimo (modo RANGO)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min?: number;

  @ApiPropertyOptional({ description: 'Valor máximo (modo RANGO)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max?: number;

  @ApiPropertyOptional({ description: 'Valor exacto (modo EXACTO)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  exacto?: number;

  @ApiPropertyOptional({ description: 'Filtrar por categoría' })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por marca' })
  @IsOptional()
  @IsString()
  empresaMarcaId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por presencia de stock',
    enum: FiltroStock,
    default: FiltroStock.AMBOS,
  })
  @IsOptional()
  @IsEnum(FiltroStock)
  stock?: FiltroStock = FiltroStock.AMBOS;

  @ApiPropertyOptional({
    description: 'Filtrar solo productos activos (default true)',
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  soloActivos?: boolean = true;

  @ApiPropertyOptional({ description: 'Límite de resultados', default: 500 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 500;
}
