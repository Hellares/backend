import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsBoolean, Min } from 'class-validator';

export class ConfiguracionEnvioDto {
  @ApiProperty({ description: 'Monto mínimo para envío gratis (null = nunca gratis)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  envioGratisDesde?: number;

  @ApiProperty({ description: 'Permitir retiro en tienda', required: false })
  @IsOptional()
  @IsBoolean()
  permiteRetiroTienda?: boolean;

  @ApiProperty({ description: 'Permitir pago contraentrega (paga al recibir)', required: false })
  @IsOptional()
  @IsBoolean()
  permiteContraentrega?: boolean;
}
