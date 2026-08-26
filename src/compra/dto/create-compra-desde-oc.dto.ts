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
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCompraGastoDto } from './create-compra-gasto.dto';
import { TerminosPago } from '@prisma/client';

export class LineaRecepcionOcDto {
  @ApiProperty({ description: 'ID del detalle de la OC' })
  @IsString()
  @IsNotEmpty()
  ordenCompraDetalleId: string;

  @ApiProperty({ description: 'Cantidad a recibir', example: 10 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number;

  @ApiPropertyOptional({ description: 'Precio unitario (si difiere del OC)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario?: number;

  @ApiPropertyOptional({
    description:
      'Nuevo precio de venta a aplicar al confirmar la compra. Si está presente, al confirmar se actualiza ProductoStock.precio.',
    example: 3.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  nuevoPrecioVenta?: number;
}

export class CreateCompraDesdeOcDto {
  @ApiProperty({ description: 'ID de la orden de compra' })
  @IsString()
  @IsNotEmpty()
  ordenCompraId: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del proveedor' })
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

  @ApiPropertyOptional({ description: 'Fecha de recepción' })
  @IsOptional()
  @IsDateString()
  fechaRecepcion?: string;

  @ApiPropertyOptional({ description: 'Moneda', example: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiPropertyOptional({ description: 'Tipo de cambio' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tipoCambio?: number;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({
    description: 'Líneas a recibir de la OC',
    type: [LineaRecepcionOcDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaRecepcionOcDto)
  lineas: LineaRecepcionOcDto[];

  @ApiPropertyOptional({
    description:
      'Gastos de la factura que no son productos (flete, movilidad, interés). El flete llega con la mercadería, así que la recepción los acepta igual que la compra standalone: suman al total, y los que tienen prorratea=true además suben el costo de los productos.',
    type: [CreateCompraGastoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompraGastoDto)
  gastos?: CreateCompraGastoDto[];
}
