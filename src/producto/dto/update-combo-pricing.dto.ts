import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsEnum, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPrecioCombo } from '@prisma/client';

/**
 * DTO para actualizar la configuración de precios de un combo
 * Permite cambiar tipo de precio, descuento y precio fijo
 */
export class UpdateComboPricingDto {
  @ApiPropertyOptional({
    description: 'Nuevo tipo de precio del combo',
    enum: TipoPrecioCombo,
    example: TipoPrecioCombo.FIJO,
  })
  @IsOptional()
  @IsEnum(TipoPrecioCombo)
  tipoPrecioCombo?: TipoPrecioCombo;

  @ApiPropertyOptional({
    description: 'Porcentaje de descuento (0-100, null para limpiar). Solo para CALCULADO_CON_DESCUENTO.',
    example: 15,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  descuentoPorcentaje?: number | null;

  @ApiPropertyOptional({
    description: 'Precio fijo del combo (solo para tipo FIJO, se aplica en la sede del query param)',
    example: 2999.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioFijo?: number;

  @ApiPropertyOptional({
    description: 'Razón o motivo del cambio de precio',
    example: 'Ajuste de precios por nueva temporada',
  })
  @IsOptional()
  @IsString()
  razon?: string;
}
