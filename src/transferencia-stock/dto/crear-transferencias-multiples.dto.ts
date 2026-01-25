import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Item individual de transferencia para transferencias múltiples
 */
export class ItemTransferenciaDto {
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
    description: 'Cantidad a transferir de este producto',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiPropertyOptional({
    description: 'Motivo específico para este producto (opcional)',
    example: 'Producto con alta rotación',
  })
  @IsOptional()
  @IsString()
  motivo?: string;
}

/**
 * DTO para crear múltiples transferencias en una sola operación
 * Permite transferir varios productos entre las mismas sedes
 */
export class CrearTransferenciasMultiplesDto {
  @ApiProperty({
    description: 'ID de la sede origen (común para todas las transferencias)',
    example: 'sede-principal-id',
  })
  @IsString()
  sedeOrigenId: string;

  @ApiProperty({
    description: 'ID de la sede destino (común para todas las transferencias)',
    example: 'sede-sucursal-id',
  })
  @IsString()
  sedeDestinoId: string;

  @ApiProperty({
    description: 'Lista de productos a transferir',
    type: [ItemTransferenciaDto],
    example: [
      {
        productoId: 'prod-001',
        cantidad: 10,
        motivo: 'Reposición',
      },
      {
        varianteId: 'var-002',
        cantidad: 5,
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe incluir al menos un producto' })
  @ValidateNested({ each: true })
  @Type(() => ItemTransferenciaDto)
  productos: ItemTransferenciaDto[];

  @ApiPropertyOptional({
    description: 'Motivo general de la transferencia (aplica a todos los productos)',
    example: 'Reabastecimiento semanal',
  })
  @IsOptional()
  @IsString()
  motivoGeneral?: string;

  @ApiPropertyOptional({
    description: 'Observaciones generales',
    example: 'Transferencia programada - semana 3',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
