import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RespondTercerizacionDto {
  @ApiProperty({ description: 'Aceptar o rechazar la solicitud' })
  @IsBoolean()
  @IsNotEmpty()
  aceptar: boolean;

  @ApiPropertyOptional({ description: 'Motivo de rechazo (requerido si rechaza)' })
  @IsOptional()
  @IsString()
  motivoRechazo?: string;

  @ApiPropertyOptional({ description: 'Notas de la empresa destino' })
  @IsOptional()
  @IsString()
  notasDestino?: string;
}
