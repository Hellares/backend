import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, Min } from 'class-validator';

export class CrearStockDto {
  @ApiProperty({
    description: 'ID de la sede',
    example: 'sede-id-123',
  })
  @IsString()
  sedeId: string;

  @ApiProperty({
    description: 'ID del producto (requerido si no hay varianteId)',
    example: 'producto-id-123',
  })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({
    description: 'ID de la variante (requerido si no hay productoId)',
    example: 'variante-id-123',
  })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({
    description: 'Stock inicial',
    example: 100,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stockActual: number;

  @ApiPropertyOptional({
    description: 'Stock mínimo',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional({
    description: 'Stock máximo',
    example: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional({
    description: 'Ubicación física en el almacén',
    example: 'Pasillo 3, Estante B',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;
}
