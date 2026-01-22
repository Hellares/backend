import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, Min } from 'class-validator';

export class CrearTransferenciaDto {
  @ApiProperty({
    description: 'ID de la sede origen',
    example: 'sede-principal-id',
  })
  @IsString()
  sedeOrigenId: string;

  @ApiProperty({
    description: 'ID de la sede destino',
    example: 'sede-sucursal-id',
  })
  @IsString()
  sedeDestinoId: string;

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
    description: 'Cantidad a transferir',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiPropertyOptional({
    description: 'Motivo de la transferencia',
    example: 'Reposición de stock en sucursal',
  })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales',
    example: 'Transferencia urgente - stock bajo',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
