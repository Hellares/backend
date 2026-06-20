import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MetodoPagoVenta, FuentePagoCompra } from '@prisma/client';

/** Pago al confirmar una compra al CONTADO (opcional: si se omite, cae en CxP). */
export class PagoContadoCompraDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty({ enum: FuentePagoCompra, required: false })
  @IsOptional()
  @IsEnum(FuentePagoCompra)
  fuente?: FuentePagoCompra;

  @ApiProperty({ required: false, description: 'FK EmpresaBanco. Requerido si fuente=BANCO.' })
  @ValidateIf((o) => o.fuente === FuentePagoCompra.BANCO)
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando fuente=BANCO' })
  bancoId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  referencia?: string;
}

export class ConfirmarCompraDto {
  @ApiProperty({
    type: PagoContadoCompraDto,
    required: false,
    description: 'Cómo se pagó (solo contado). Si se omite, la compra queda pendiente en CxP.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PagoContadoCompraDto)
  pago?: PagoContadoCompraDto;
}
