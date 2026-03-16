import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MetodoPagoVenta } from '@prisma/client';

export class ProcesarPagoDto {
  @ApiProperty({ description: 'Metodo de pago', enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({ description: 'Monto del pago', example: 100 })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  monto: number;

  @ApiPropertyOptional({ description: 'Referencia del pago (voucher, nro operacion)' })
  @IsOptional()
  @IsString()
  referencia?: string;
}
