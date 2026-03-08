import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CompleteTercerizacionDto {
  @ApiProperty({ description: 'Precio B2B del servicio realizado' })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  @Type(() => Number)
  precioB2B: number;

  @ApiPropertyOptional({ description: 'Método de pago B2B' })
  @IsOptional()
  @IsString()
  metodoPagoB2B?: string;

  @ApiPropertyOptional({ description: 'Notas finales' })
  @IsOptional()
  @IsString()
  notasDestino?: string;
}
