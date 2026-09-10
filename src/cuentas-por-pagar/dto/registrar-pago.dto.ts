import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { MetodoPagoVenta, FuentePagoCompra } from '@prisma/client';

export class RegistrarPagoCuentaPagarDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({
    description:
      'Lo que SALE de la fuente, en la moneda de esa fuente (los soles de la ' +
      'caja, el saldo del banco).',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bancoDestino?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cuentaDestino?: string;

  @ApiProperty({ required: false, description: 'URL del comprobante ya subido (S3)' })
  @IsOptional()
  @IsString()
  comprobanteUrl?: string;

  @ApiProperty({
    enum: FuentePagoCompra,
    required: false,
    description:
      'De dónde sale el dinero. Default: EFECTIVO→TESORERIA, digital→BANCO.',
  })
  @IsOptional()
  @IsEnum(FuentePagoCompra)
  fuente?: FuentePagoCompra;

  @ApiProperty({
    required: false,
    description:
      'FK EmpresaBanco. Requerido si fuente=BANCO (explícito o por default: ' +
      'todo método != EFECTIVO sin fuente cae a BANCO).',
  })
  // También se exige cuando el método NO es EFECTIVO y no se mandó fuente, porque
  // el util defaultea a BANCO (que requiere bancoId) — así el 400 es temprano y
  // claro en vez de fallar recién al rutear el egreso.
  @ValidateIf(
    (o) =>
      o.fuente === FuentePagoCompra.BANCO ||
      (!o.fuente && o.metodoPago !== MetodoPagoVenta.EFECTIVO),
  )
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando el pago sale de una cuenta bancaria' })
  bancoId?: string;
}
