import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { MetodoPagoVenta } from '@prisma/client';

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
}
