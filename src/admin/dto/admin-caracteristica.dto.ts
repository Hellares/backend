import { IsEnum, IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaracteristicaPremium, OrigenCaracteristica } from '@prisma/client';

/**
 * Activar/desactivar una característica premium de una empresa (super admin).
 */
export class AdminCaracteristicaDto {
  @ApiProperty({ enum: CaracteristicaPremium, example: 'YAPE_QR' })
  @IsEnum(CaracteristicaPremium)
  caracteristica: CaracteristicaPremium;

  @ApiProperty({ description: 'Habilitar (true) o deshabilitar (false)' })
  @IsBoolean()
  habilitado: boolean;

  @ApiPropertyOptional({
    description:
      'Vigencia: ISO date = vence en esa fecha (trial); null = permanente; omitir = no cambiar.',
    example: '2026-08-19T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  vigenteHasta?: string | null;

  @ApiPropertyOptional({ enum: OrigenCaracteristica, example: 'TRIAL' })
  @IsOptional()
  @IsEnum(OrigenCaracteristica)
  origen?: OrigenCaracteristica;

  @ApiPropertyOptional({ description: 'Nota interna del admin' })
  @IsOptional()
  @IsString()
  notaAdmin?: string;
}
