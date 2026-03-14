import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RespondVinculacionDto {
  @ApiProperty({ description: 'Aceptar o rechazar la solicitud' })
  @IsBoolean()
  @IsNotEmpty()
  aceptar: boolean;

  @ApiPropertyOptional({ description: 'Motivo de rechazo (requerido si rechaza)' })
  @IsOptional()
  @IsString()
  motivoRechazo?: string;
}
