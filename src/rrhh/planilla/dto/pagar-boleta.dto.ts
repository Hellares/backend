import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { MetodoPagoVenta } from '@prisma/client';

export class PagarBoletaDto {
  @ApiProperty({
    description: 'Método de pago',
    enum: MetodoPagoVenta,
    example: MetodoPagoVenta.TRANSFERENCIA,
  })
  @IsNotEmpty({ message: 'El método de pago es requerido' })
  @IsEnum(MetodoPagoVenta, { message: 'Método de pago inválido' })
  metodoPago: MetodoPagoVenta;
}
