import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, IsOptional, Min } from 'class-validator';
import {
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
} from '@prisma/client';

export class CrearMovimientoDto {
  @ApiProperty({ enum: TipoMovimientoCaja })
  @IsEnum(TipoMovimientoCaja)
  tipo: TipoMovimientoCaja;

  @ApiProperty({ enum: CategoriaMovimientoCaja })
  @IsEnum(CategoriaMovimientoCaja)
  categoria: CategoriaMovimientoCaja;

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
  descripcion?: string;

  @ApiProperty({ required: false, description: 'ID de categoría de gasto personalizada' })
  @IsOptional()
  @IsString()
  categoriaGastoId?: string;
}
