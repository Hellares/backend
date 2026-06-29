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

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

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
