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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateOrdenCompraDetalleDto } from './create-orden-compra-detalle.dto';
import { TerminosPago } from '@prisma/client';

export class CreateOrdenCompraDto {
  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'ID del proveedor' })
  @IsString()
  @IsNotEmpty()
  proveedorId: string;

  @ApiPropertyOptional({ description: 'Términos de pago', enum: TerminosPago })
  @IsOptional()
  @IsEnum(TerminosPago)
  terminosPago?: TerminosPago;

  @ApiPropertyOptional({ description: 'Días de crédito' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  diasCredito?: number;

  @ApiPropertyOptional({ description: 'Moneda', example: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiPropertyOptional({ description: 'Tipo de cambio' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tipoCambio?: number;

  @ApiPropertyOptional({ description: 'Fecha de entrega esperada' })
  @IsOptional()
  @IsDateString()
  fechaEntregaEsperada?: string;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Condiciones comerciales' })
  @IsOptional()
  @IsString()
  condiciones?: string;

  @ApiProperty({
    description: 'Detalles de la orden de compra',
    type: [CreateOrdenCompraDetalleDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrdenCompraDetalleDto)
  detalles: CreateOrdenCompraDetalleDto[];
}
