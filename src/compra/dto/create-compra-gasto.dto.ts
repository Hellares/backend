import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CriterioProrrateo } from '@prisma/client';

/**
 * Gasto de la factura del proveedor que no es un producto.
 *
 * Ver el modelo `CompraGasto`: siempre suma al total de la compra (para que
 * cuadre con la factura), y sube el costo de los productos solo si
 * `prorratea`.
 */
export class CreateCompraGastoDto {
  @ApiProperty({
    description: 'Concepto del gasto',
    example: 'Movilidad Lima-Trujillo',
  })
  @IsString()
  @IsNotEmpty()
  concepto: string;

  @ApiProperty({
    description: 'Monto cobrado por el proveedor, con IGV adentro si lo tiene',
    example: 30,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monto: number;

  @ApiPropertyOptional({
    description:
      'IGV del gasto. 0 (default) para el recibo simple del transportista; 18 si viene gravado dentro de la factura',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  porcentajeIGV?: number;

  @ApiPropertyOptional({
    description:
      '¿Sube el costo de los productos? true (default) para fletes; false para intereses, multas o cargos que se le trasladan al cliente',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  prorratea?: boolean;

  @ApiPropertyOptional({
    description:
      'Cómo se reparte entre las líneas: VALOR (default, proporcional al total de cada línea) o CANTIDAD (por unidades)',
    enum: CriterioProrrateo,
    default: CriterioProrrateo.VALOR,
  })
  @IsOptional()
  @IsEnum(CriterioProrrateo)
  criterio?: CriterioProrrateo;

  @ApiPropertyOptional({ description: 'Orden de presentación' })
  @IsOptional()
  @IsInt()
  orden?: number;
}
