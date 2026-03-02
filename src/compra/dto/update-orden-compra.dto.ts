import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateOrdenCompraDetalleDto } from './create-orden-compra-detalle.dto';
import { TerminosPago } from '@prisma/client';

export class UpdateOrdenCompraDto {
  @ApiPropertyOptional({ description: 'ID del proveedor' })
  @IsOptional()
  @IsString()
  proveedorId?: string;

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

  @ApiPropertyOptional({
    description: 'Detalles (reemplaza todos los existentes)',
    type: [CreateOrdenCompraDetalleDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrdenCompraDetalleDto)
  detalles?: CreateOrdenCompraDetalleDto[];
}
