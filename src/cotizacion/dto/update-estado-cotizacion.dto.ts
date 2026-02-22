import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoCotizacion } from '@prisma/client';

export class UpdateEstadoCotizacionDto {
  @ApiProperty({ description: 'Nuevo estado', enum: EstadoCotizacion })
  @IsEnum(EstadoCotizacion)
  estado: EstadoCotizacion;

  @ApiPropertyOptional({ description: 'ID del comprobante (solo para CONVERTIDA)' })
  @IsOptional()
  @IsString()
  comprobanteId?: string;
}
