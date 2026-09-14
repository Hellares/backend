import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsEnum, IsOptional } from 'class-validator';
import { TipoMovimientoStock } from '@prisma/client';

export class AjustarStockDto {
  @ApiProperty({
    description:
      'Tipo de movimiento. Solo los de ajuste (ver `tipos-ajuste-manual.ts`): el resto tiene su propio flujo y se rechaza con 400',
    enum: TipoMovimientoStock,
    example: TipoMovimientoStock.AJUSTE_ENTRADA,
  })
  @IsEnum(TipoMovimientoStock)
  tipo: TipoMovimientoStock;

  @ApiProperty({
    description: 'Cantidad a ajustar (positivo para entrada, negativo para salida)',
    example: 50,
  })
  @IsInt()
  cantidad: number;

  @ApiPropertyOptional({
    description: 'Motivo del ajuste',
    example: 'Ajuste por inventario físico',
  })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales',
    example: 'Diferencia encontrada en conteo manual',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    description: 'Tipo de documento',
    example: 'AJUSTE',
  })
  @IsOptional()
  @IsString()
  tipoDocumento?: string;

  @ApiPropertyOptional({
    description: 'Número de documento',
    example: 'AJ-2026-001',
  })
  @IsOptional()
  @IsString()
  numeroDocumento?: string;
}
