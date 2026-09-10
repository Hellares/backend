import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MetodoPagoVenta, FuentePagoCompra } from '@prisma/client';

/** Pago al confirmar una compra al CONTADO (opcional: si se omite, cae en CxP). */
export class PagoContadoCompraDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({ enum: FuentePagoCompra, required: false })
  @IsOptional()
  @IsEnum(FuentePagoCompra)
  fuente?: FuentePagoCompra;

  @ApiProperty({ required: false, description: 'FK EmpresaBanco. Requerido si fuente=BANCO.' })
  @ValidateIf((o) => o.fuente === FuentePagoCompra.BANCO)
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando fuente=BANCO' })
  bancoId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiProperty({
    required: false,
    description:
      'Pago parcial, en la moneda de la FUENTE. Si se omite, paga el total.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto?: number;

  @ApiProperty({
    required: false,
    description:
      'Tipo de cambio del DÍA DEL PAGO, a mano. OBLIGATORIO cuando la moneda ' +
      'de la compra no es la de la fuente (pagar una factura en USD desde una ' +
      'caja en soles). No tiene por qué ser el de la compra: esa diferencia es ' +
      'la diferencia de cambio.',
    example: 3.755,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  tipoCambio?: number;

  @ApiProperty({
    required: false,
    description:
      'Lo que este pago CANCELA de la deuda, en la moneda de la COMPRA. Si se ' +
      'omite y hay tipoCambio, sale de `monto / tipoCambio`. `monto` sigue ' +
      'siendo lo que sale de la fuente (los soles de la caja).',
    example: 242.49,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoAplicado?: number;
}

export class ConfirmarCompraDto {
  @ApiProperty({
    type: PagoContadoCompraDto,
    required: false,
    description: 'Cómo se pagó (solo contado). Si se omite, la compra queda pendiente en CxP.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PagoContadoCompraDto)
  pago?: PagoContadoCompraDto;
}
