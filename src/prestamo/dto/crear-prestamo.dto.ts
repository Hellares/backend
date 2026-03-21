import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsEnum, IsDateString, Min, IsInt } from 'class-validator';
import { TipoPrestamo, MetodoPagoVenta } from '@prisma/client';

export class CrearPrestamoDto {
  @ApiProperty({ enum: TipoPrestamo })
  @IsEnum(TipoPrestamo)
  tipo: TipoPrestamo;

  @ApiProperty({ example: 'BCP' })
  @IsString()
  entidadPrestamo: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  montoOriginal: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaInteres?: number;

  @ApiProperty({ required: false, default: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidadCuotas?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  montoCuota?: number;

  @ApiProperty()
  @IsDateString()
  fechaDesembolso: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class RegistrarPagoPrestamoDto {
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
}
