import { ApiProperty } from '@nestjs/swagger';
import { FuentePagoGasto, MetodoPagoVenta } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
  Matches,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class PagarGastoRecurrenteDto {
  @ApiProperty({ example: '2026-05', description: 'Período YYYY-MM al que aplica el pago' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'periodo debe tener formato YYYY-MM',
  })
  periodo: string;

  @ApiProperty({ example: 318.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoReal: number;

  @ApiProperty({ enum: FuentePagoGasto })
  @IsEnum(FuentePagoGasto)
  fuente: FuentePagoGasto;

  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({ required: false, description: 'Requerido si fuente=CAJA — caja debe estar ABIERTA' })
  @ValidateIf((o) => o.fuente === FuentePagoGasto.CAJA)
  @IsString()
  @IsNotEmpty({ message: 'cajaId es obligatorio cuando fuente=CAJA' })
  cajaId?: string;

  @ApiProperty({ required: false, description: 'Requerido si fuente=BANCO — FK EmpresaBanco activa' })
  @ValidateIf((o) => o.fuente === FuentePagoGasto.BANCO)
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando fuente=BANCO' })
  bancoId?: string;

  @ApiProperty({ required: false, description: 'URL S3 Contabo del comprobante (foto del recibo)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  comprobanteUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}
