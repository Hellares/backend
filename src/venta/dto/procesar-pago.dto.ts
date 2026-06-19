import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
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

  @ApiPropertyOptional({
    description:
      'Banco / entidad financiera. Requerido por bancarización (Ley 28194) en TARJETA/TRANSFERENCIA cuando la venta supera el umbral.',
  })
  @IsOptional()
  @IsString()
  banco?: string;

  @ApiPropertyOptional({ description: 'ID de cuota especifica a pagar' })
  @IsOptional()
  @IsString()
  cuotaVentaId?: string;

  @ApiPropertyOptional({
    description:
      'Confirmación del cajero para pago en efectivo sobre el umbral de bancarización (Ley 28194)',
  })
  @IsOptional()
  @IsBoolean()
  aceptaRiesgoBancarizacion?: boolean;
}
