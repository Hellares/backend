import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, IsOptional, Min } from 'class-validator';
import { TipoMovimientoCaja, MetodoPagoVenta } from '@prisma/client';

/**
 * Ajuste manual sobre la Caja Central (Tesoreria) de una sede.
 * Crea un movimiento con categoria=AJUSTE_TESORERIA. Sirve para que el
 * admin compense diferencias, registre retiros/depositos extra, o haga
 * correcciones contables.
 */
export class AjusteTesoreriaDto {
  @ApiProperty({
    enum: TipoMovimientoCaja,
    description: 'INGRESO (deposito) o EGRESO (retiro)',
  })
  @IsEnum(TipoMovimientoCaja)
  tipo: TipoMovimientoCaja;

  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiProperty({ description: 'Motivo del ajuste (obligatorio para trazabilidad)' })
  @IsString()
  descripcion: string;

  @ApiProperty({
    required: false,
    description: 'Categoria de gasto personalizada (solo para EGRESO)',
  })
  @IsOptional()
  @IsString()
  categoriaGastoId?: string;
}
