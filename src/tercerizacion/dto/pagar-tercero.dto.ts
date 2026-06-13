import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/** Registrar el pago de la empresa origen al tercero (egreso PAGO_PROVEEDOR). */
export class PagarTerceroDto {
  @ApiProperty({
    description: 'Método de pago del egreso al tercero',
    enum: ['EFECTIVO', 'TARJETA', 'YAPE', 'PLIN', 'TRANSFERENCIA'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['EFECTIVO', 'TARJETA', 'YAPE', 'PLIN', 'TRANSFERENCIA'])
  metodoPago: string;
}
