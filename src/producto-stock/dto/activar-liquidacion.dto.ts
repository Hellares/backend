import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MotivoLiquidacion } from '@prisma/client';

/**
 * Activa el estado "EN LIQUIDACIÓN" sobre un ProductoStock.
 * Requiere autorización gerencial (DNI + password) — el front llama primero a
 * /auth/autorizar-operacion y pasa el `autorizadoPorId` resultante en este DTO.
 */
export class ActivarLiquidacionDto {
  @ApiProperty({
    description: 'Precio de liquidación (debe ser menor al precioCosto del stock)',
    example: 35.0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioLiquidacion: number;

  @ApiProperty({
    description: 'Motivo de la liquidación',
    enum: MotivoLiquidacion,
    example: MotivoLiquidacion.FUERA_DE_CAMPANA,
  })
  @IsEnum(MotivoLiquidacion)
  motivoLiquidacion: MotivoLiquidacion;

  @ApiPropertyOptional({
    description: 'Fecha de fin de la liquidación (ISO). Si se omite, queda vigente hasta desactivación manual.',
    example: '2026-06-30T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @ApiPropertyOptional({
    description: 'Observaciones (obligatorio si motivo = OTRO)',
    example: 'Cambio de catálogo para nueva temporada',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({
    description: 'ID del usuario que autorizó la liquidación (de /auth/autorizar-operacion)',
  })
  @IsString()
  @IsNotEmpty()
  autorizadoPorId: string;
}
