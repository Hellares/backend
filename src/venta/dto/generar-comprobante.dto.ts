import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerarComprobanteDto {
  @ApiProperty({ description: 'Tipo de comprobante', enum: ['BOLETA', 'FACTURA'] })
  @IsEnum(['BOLETA', 'FACTURA'])
  tipoComprobante: 'BOLETA' | 'FACTURA';

  @ApiPropertyOptional({ description: 'Tipo documento cliente (1=DNI, 6=RUC)' })
  @IsOptional()
  @IsString()
  tipoDocumentoCliente?: string;
}
