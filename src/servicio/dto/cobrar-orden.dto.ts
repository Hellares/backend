import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CobrarOrdenDto {
  @ApiPropertyOptional({ description: 'Método de pago' })
  @IsOptional()
  @IsString()
  metodoPago?: string; // EFECTIVO, TARJETA, YAPE, PLIN, TRANSFERENCIA

  @ApiPropertyOptional({ description: 'Monto recibido' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoRecibido?: number;

  @ApiPropertyOptional({ description: 'Tipo de comprobante', example: 'BOLETA' })
  @IsOptional()
  @IsString()
  tipoComprobante?: string; // BOLETA, FACTURA

  @ApiPropertyOptional({ description: 'Tipo de documento del cliente', example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDocumentoCliente?: string; // 1=DNI, 6=RUC

  @ApiPropertyOptional({ description: 'Condición de pago', example: 'CONTADO' })
  @IsOptional()
  @IsString()
  condicionPago?: string;

  @ApiPropertyOptional({ description: 'Referencia del pago' })
  @IsOptional()
  @IsString()
  referenciaPago?: string;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
