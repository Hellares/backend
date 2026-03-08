import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoOrdenServicio } from '@prisma/client';

export class TransitionEstadoDto {
  @ApiProperty({
    description: 'Nuevo estado de la orden',
    enum: EstadoOrdenServicio,
  })
  @IsEnum(EstadoOrdenServicio)
  nuevoEstado: EstadoOrdenServicio;

  @ApiPropertyOptional({ description: 'Notas sobre la transición' })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({ description: 'Diagnóstico (JSON)' })
  @IsOptional()
  diagnostico?: any;

  @ApiPropertyOptional({
    description: 'Comunicar cambio al cliente',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  comunicarCliente?: boolean;

  @ApiPropertyOptional({ description: 'Motivo de reingreso (cuando se reabre una orden entregada/finalizada)' })
  @IsOptional()
  @IsString()
  motivoReingreso?: string;

  @ApiPropertyOptional({ description: 'Costo total acordado del servicio' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costoTotal?: number;

  @ApiPropertyOptional({ description: 'Adelanto entregado por el cliente' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adelanto?: number;

  @ApiPropertyOptional({ description: 'Descuento aplicado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Método de pago del adelanto (EFECTIVO, YAPE, PLIN, TARJETA, etc.)' })
  @IsOptional()
  @IsString()
  metodoPagoAdelanto?: string;
}
