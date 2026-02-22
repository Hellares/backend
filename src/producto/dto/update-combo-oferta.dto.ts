import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para actualizar la oferta de un combo
 * La oferta aplica sobre el precio final calculado (post-descuento)
 */
export class UpdateComboOfertaDto {
  @ApiProperty({
    description: 'Precio de oferta (aplica sobre el precio final del combo)',
    example: 1999.99,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioOferta: number;

  @ApiProperty({
    description: 'Activar o desactivar la oferta',
    example: true,
  })
  @IsBoolean()
  enOferta: boolean;

  @ApiPropertyOptional({
    description: 'Fecha de inicio de la oferta (ISO 8601)',
    example: '2026-03-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  fechaInicioOferta?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin de la oferta (ISO 8601)',
    example: '2026-03-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  fechaFinOferta?: string;

  @ApiPropertyOptional({
    description: 'Razón o motivo de la oferta',
    example: 'Promoción de temporada',
  })
  @IsOptional()
  @IsString()
  razon?: string;
}
