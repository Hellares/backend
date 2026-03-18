import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MetodoPagoVenta } from '@prisma/client';

export class CreateVentaDesdeCotizacionDto {
  @ApiPropertyOptional({ description: 'Metodo de pago principal', enum: MetodoPagoVenta })
  @IsOptional()
  @IsEnum(MetodoPagoVenta)
  metodoPago?: MetodoPagoVenta;

  @ApiPropertyOptional({ description: 'Monto recibido' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoRecibido?: number;

  @ApiPropertyOptional({ description: 'Es venta a credito' })
  @IsOptional()
  @IsBoolean()
  esCredito?: boolean;

  @ApiPropertyOptional({ description: 'Plazo de credito en dias' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  plazoCredito?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago' })
  @IsOptional()
  @IsDateString()
  fechaVencimientoPago?: string;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Tipo de comprobante', example: 'BOLETA' })
  @IsOptional()
  @IsString()
  tipoComprobante?: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del cliente', example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDocumentoCliente?: string;

  @ApiPropertyOptional({ description: 'Condicion de pago', example: 'CONTADO' })
  @IsOptional()
  @IsString()
  condicionPago?: string;

  @ApiPropertyOptional({ description: 'Referencia del pago' })
  @IsOptional()
  @IsString()
  referenciaPago?: string;
}
