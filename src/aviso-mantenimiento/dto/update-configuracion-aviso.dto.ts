import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';

export class UpdateConfiguracionAvisoDto {
  @ApiPropertyOptional({
    description: 'Intervalos por tipo de servicio en días (JSON)',
    example: { MANTENIMIENTO: 120, REPARACION: 180 },
  })
  @IsOptional()
  intervalos?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Días de anticipación para generar el aviso' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  diasAnticipacion?: number;

  @ApiPropertyOptional({ description: 'Habilitar/deshabilitar avisos' })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
