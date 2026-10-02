import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { FuenteIngreso, MetodoPagoVenta } from '@prisma/client';

/** Cuánto del depósito va a UNA venta. */
export class LineaRepartoDto {
  @ApiProperty()
  @IsString()
  ventaId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;
}

/** Repartir el saldo a favor de UN cliente (persona o empresa) entre sus ventas. */
export class AplicarDepositoDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiProperty({ type: [LineaRepartoDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos una venta' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineaRepartoDto)
  lineas: LineaRepartoDto[];
}

/**
 * Un depósito del cliente sin decir qué paga. `lineas` es opcional: se puede
 * registrar y repartir en el mismo acto, o dejarlo entero a favor.
 */
export class RegistrarDepositoDto {
  @ApiProperty({ required: false, description: 'Ficha de cliente (EmpresaPersona). Va este O clienteEmpresaId.' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  referencia?: string;

  @ApiProperty({ enum: FuenteIngreso, required: false })
  @IsOptional()
  @IsEnum(FuenteIngreso)
  fuente?: FuenteIngreso;

  // Igual que el abono: sin fuente, un método digital cae a BANCO y pide cuenta.
  @ApiProperty({ required: false })
  @ValidateIf((o) => o.fuente === FuenteIngreso.BANCO || (!o.fuente && o.metodoPago !== MetodoPagoVenta.EFECTIVO))
  @IsString()
  @IsNotEmpty({ message: 'Elige la cuenta bancaria a la que entró el depósito' })
  bancoId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;

  @ApiProperty({ type: [LineaRepartoDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineaRepartoDto)
  lineas?: LineaRepartoDto[];
}
