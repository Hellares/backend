import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MetodoPagoVenta } from '@prisma/client';

/**
 * Pago individual dentro de una venta. Soporta multi-medio (Ley 28194 Fase 2).
 *
 * - YAPE/PLIN: requieren `referencia`.
 * - TARJETA/TRANSFERENCIA: requieren `referencia` y `banco`.
 * - EFECTIVO: no requiere ninguno.
 */
export class CreatePagoVentaDto {
  @ApiProperty({ description: 'Metodo de pago', enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago!: MetodoPagoVenta;

  @ApiProperty({ description: 'Monto en soles (PEN)' })
  @IsNumber()
  @Type(() => Number)
  monto!: number;

  @ApiPropertyOptional({ description: 'N° de operación / voucher' })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiPropertyOptional({ description: 'Entidad financiera (TARJETA/TRANSFERENCIA)' })
  @IsOptional()
  @IsString()
  banco?: string;

  @ApiPropertyOptional({ description: 'Moneda original (PEN/USD)' })
  @IsOptional()
  @IsString()
  monedaOriginal?: string;

  @ApiPropertyOptional({ description: 'Monto en la moneda original' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoOriginal?: number;

  @ApiPropertyOptional({ description: 'Tipo de cambio aplicado' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tipoCambio?: number;
}
