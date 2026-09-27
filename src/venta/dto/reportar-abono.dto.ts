import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const METODOS_ABONO_CLIENTE = ['YAPE', 'PLIN', 'TRANSFERENCIA'] as const;
export type MetodoAbonoCliente = (typeof METODOS_ABONO_CLIENTE)[number];

/** Cuánto del pago va a UNA compra. */
export class LineaAbonoDto {
  @ApiProperty()
  @IsString()
  ventaId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;
}

/**
 * El pago que el cliente reporta desde "Mis compras": a qué compras va y
 * cuánto a cada una. Llega como multipart (con las capturas), así que
 * `lineas` viaja como JSON en texto.
 */
export class ReportarAbonoDto {
  @ApiProperty({ type: [LineaAbonoDto], description: 'JSON: [{ ventaId, monto }]' })
  @Transform(({ value }) => {
    let lista: unknown = value;
    if (typeof value === 'string') {
      try { lista = JSON.parse(value); } catch { return value; }
    }
    return Array.isArray(lista) ? lista.map((x) => plainToInstance(LineaAbonoDto, x)) : lista;
  })
  @IsArray({ message: 'Elige a qué compras va el pago' })
  @ArrayMinSize(1, { message: 'Elige al menos una compra' })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  lineas: LineaAbonoDto[];

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
