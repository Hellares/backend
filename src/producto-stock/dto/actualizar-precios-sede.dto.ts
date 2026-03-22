import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsString,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Tipos de cambio de precio para auditoría
 * Coincide con el enum TipoCambioPrecio del schema de Prisma
 */
export enum TipoCambioPrecioSede {
  MANUAL = 'MANUAL',
  OFERTA = 'OFERTA',
  COSTO = 'COSTO',
  MASIVO = 'MASIVO',
  AJUSTE_MERCADO = 'AJUSTE_MERCADO',
  COMPETENCIA = 'COMPETENCIA',
  CORRECCION = 'CORRECCION',
}

/**
 * DTO para actualizar los precios de un producto en una sede específica
 * Permite actualizar precios de forma independiente sin afectar el stock
 */
export class ActualizarPreciosSedeDto {
  @ApiPropertyOptional({
    description:
      'Precio de venta en esta sede (null para usar precio base del producto)',
    example: 99.99,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precio?: number | null;

  @ApiPropertyOptional({
    description:
      'Precio de costo en esta sede (para cálculo de márgenes)',
    example: 50.0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioCosto?: number | null;

  @ApiPropertyOptional({
    description: 'Precio de oferta específico de la sede',
    example: 79.99,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOferta?: number | null;

  @ApiPropertyOptional({
    description: 'Si el producto está en oferta en esta sede',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enOferta?: boolean;

  @ApiPropertyOptional({
    description: 'Fecha de inicio de oferta en esta sede',
    example: '2024-01-15T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  fechaInicioOferta?: string | null;

  @ApiPropertyOptional({
    description: 'Fecha de fin de oferta en esta sede',
    example: '2024-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  fechaFinOferta?: string | null;

  @ApiPropertyOptional({
    description: 'Indica si el precio de venta ya incluye IGV',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  precioIncluyeIgv?: boolean;

  @ApiPropertyOptional({
    description: 'Tipo de cambio de precio',
    enum: TipoCambioPrecioSede,
    example: TipoCambioPrecioSede.MANUAL,
  })
  @IsOptional()
  @IsEnum(TipoCambioPrecioSede)
  tipoCambio?: TipoCambioPrecioSede;

  @ApiPropertyOptional({
    description: 'Razón del cambio de precio',
    example: 'Ajuste por competencia en la zona',
  })
  @IsOptional()
  @IsString()
  razon?: string;

  @ApiPropertyOptional({
    description: 'Ubicación física en el almacén',
    example: 'ZONA-A - Zona A Principal',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;

  @ApiPropertyOptional({ description: 'Stock mínimo', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stockMinimo?: number;

  @ApiPropertyOptional({ description: 'Stock máximo', example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  stockMaximo?: number;
}
