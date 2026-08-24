import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCompraDetalleDto } from './create-compra-detalle.dto';
import { CreateCompraGastoDto } from './create-compra-gasto.dto';
import { TerminosPago } from '@prisma/client';

export class CreateCompraDto {
  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'ID del proveedor' })
  @IsString()
  @IsNotEmpty()
  proveedorId: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del proveedor (factura/boleta)' })
  @IsOptional()
  @IsString()
  tipoDocumentoProveedor?: string;

  @ApiPropertyOptional({ description: 'Serie del documento del proveedor' })
  @IsOptional()
  @IsString()
  serieDocumentoProveedor?: string;

  @ApiPropertyOptional({ description: 'Número del documento del proveedor' })
  @IsOptional()
  @IsString()
  numeroDocumentoProveedor?: string;

  @ApiPropertyOptional({ description: 'Términos de pago', enum: TerminosPago })
  @IsOptional()
  @IsEnum(TerminosPago)
  terminosPago?: TerminosPago;

  @ApiPropertyOptional({ description: 'Días de crédito' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  diasCredito?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento de pago' })
  @IsOptional()
  @IsDateString()
  fechaVencimientoPago?: string;

  @ApiPropertyOptional({ description: 'Moneda', example: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiPropertyOptional({ description: 'Tipo de cambio' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tipoCambio?: number;

  @ApiPropertyOptional({ description: 'Fecha de recepción' })
  @IsOptional()
  @IsDateString()
  fechaRecepcion?: string;

  @ApiPropertyOptional({
    description:
      'true (default): los precios unitarios ingresados YA incluyen IGV (lo común en Perú). false: el precio es la base imponible y el IGV se suma encima.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  precioIncluyeIgv?: boolean;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({
    description: 'Detalles de la compra',
    type: [CreateCompraDetalleDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCompraDetalleDto)
  detalles: CreateCompraDetalleDto[];

  @ApiPropertyOptional({
    description:
      'Gastos de la factura que no son productos (flete, movilidad, interés). Suman al total de la compra; los que tienen prorratea=true además suben el costo de los productos.',
    type: [CreateCompraGastoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompraGastoDto)
  gastos?: CreateCompraGastoDto[];
}
