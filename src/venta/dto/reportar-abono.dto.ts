import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const METODOS_ABONO_CLIENTE = ['YAPE', 'PLIN', 'TRANSFERENCIA'] as const;
export type MetodoAbonoCliente = (typeof METODOS_ABONO_CLIENTE)[number];

/** El pago que el cliente reporta desde "Mis compras" (multipart: van como texto). */
export class ReportarAbonoDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

  @ApiProperty({ enum: METODOS_ABONO_CLIENTE })
  @IsIn(METODOS_ABONO_CLIENTE as unknown as string[])
  metodoPago: MetodoAbonoCliente;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  numeroOperacion?: string;

  @ApiProperty({ required: false, description: 'Cuenta de la tienda a la que transfirió (solo TRANSFERENCIA)' })
  @IsOptional()
  @IsString()
  empresaBancoId?: string;
}
