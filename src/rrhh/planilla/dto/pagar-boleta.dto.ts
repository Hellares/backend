import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MetodoPagoVenta, FuenteEgreso } from '@prisma/client';

export class PagarBoletaDto {
  @ApiProperty({
    description: 'Método de pago',
    enum: MetodoPagoVenta,
    example: MetodoPagoVenta.TRANSFERENCIA,
  })
  @IsNotEmpty({ message: 'El método de pago es requerido' })
  @IsEnum(MetodoPagoVenta, { message: 'Método de pago inválido' })
  metodoPago: MetodoPagoVenta;

  @ApiPropertyOptional({
    description:
      'De dónde sale el dinero: TESORERIA (caja central), CAJA (caja operativa) o BANCO (cuenta bancaria). Si se omite: EFECTIVO→TESORERIA, digital→BANCO.',
    enum: FuenteEgreso,
  })
  @IsOptional()
  @IsEnum(FuenteEgreso, { message: 'Fuente de pago inválida' })
  fuente?: FuenteEgreso;

  @ApiPropertyOptional({
    description: 'ID de la cuenta bancaria (requerido si fuente=BANCO)',
  })
  @IsOptional()
  @IsString()
  bancoId?: string;
}
