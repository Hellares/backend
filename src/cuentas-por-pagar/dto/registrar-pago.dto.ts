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
  @IsNumber()
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
    description: 'FK EmpresaBanco. Requerido si fuente=BANCO.',
  })
  @ValidateIf((o) => o.fuente === FuentePagoCompra.BANCO)
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando fuente=BANCO' })
  bancoId?: string;
}
