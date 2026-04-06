import { IsOptional, IsString, IsInt, Min, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryGuiasRemisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sedeId?: string;

  @ApiPropertyOptional({ enum: ['REMITENTE', 'TRANSPORTISTA'] })
  @IsOptional() @IsEnum(['REMITENTE', 'TRANSPORTISTA'])
  tipo?: string;

  @ApiPropertyOptional({
    enum: ['BORRADOR', 'REGISTRADO', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ANULADO'],
  })
  @IsOptional() @IsEnum(['BORRADOR', 'REGISTRADO', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ANULADO'])
  estado?: string;

  @ApiPropertyOptional({
    enum: ['PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR_COMUNICACION', 'PROCESANDO'],
  })
  @IsOptional() @IsEnum(['PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR_COMUNICACION', 'PROCESANDO'])
  sunatStatus?: string;

  @ApiPropertyOptional({
    enum: [
      'VENTA', 'COMPRA', 'TRASLADO_ENTRE_ESTABLECIMIENTOS',
      'DEVOLUCION', 'OTROS', 'CONSIGNACION',
    ],
  })
  @IsOptional() @IsString()
  motivoTraslado?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() fechaDesde?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fechaHasta?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() busqueda?: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 }) @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  limit?: number;
}
