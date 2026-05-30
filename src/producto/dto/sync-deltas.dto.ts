import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsISO8601 } from 'class-validator';
import { ProductoResponseDto } from './producto-response.dto';

/**
 * Query del endpoint de sync diferencial del catálogo de productos.
 *
 * Si `lastSync` viene vacío o es mayor a 24h, el endpoint responde con
 * `fullSyncRequired: true` y arrays vacíos — el cliente debe hacer un
 * `getProductos` normal en vez de aplicar deltas (porque el delta sería
 * más grande que el catálogo completo, y la lógica de merge se rompe
 * con cambios masivos como una importación de Excel del admin).
 */
export class SyncDeltasQueryDto {
  @ApiPropertyOptional({
    description:
      'Timestamp ISO8601 del último sync. Si vacío o > 24h, fuerza full sync.',
    example: '2026-05-22T08:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  lastSync?: string;

  @ApiPropertyOptional({
    description: 'Sede para filtrar stock/precios efectivos.',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;
}

/**
 * Respuesta del sync diferencial. El cliente aplica los deltas sobre
 * su cache local: reemplaza/agrega los `updated` por id y elimina los
 * `deleted`. Después guarda `serverTime` como nuevo `lastSync`.
 */
export class SyncDeltasResponseDto {
  @ApiProperty({
    description:
      'Productos creados o modificados desde lastSync. Vacío si fullSyncRequired.',
    type: [ProductoResponseDto],
  })
  updated: ProductoResponseDto[];

  @ApiProperty({
    description: 'IDs de productos eliminados (soft-delete) desde lastSync.',
    type: [String],
  })
  deleted: string[];

  @ApiProperty({
    description:
      'Timestamp del servidor al momento de responder. El cliente lo guarda como nuevo lastSync.',
    example: '2026-05-22T08:30:15.123Z',
  })
  serverTime: string;

  @ApiProperty({
    description:
      'true si el cliente DEBE descartar los deltas y hacer un getProductos completo (lastSync vacío, demasiado viejo, o demasiados cambios).',
    example: false,
  })
  fullSyncRequired: boolean;

  @ApiPropertyOptional({
    description:
      'Total autoritativo de productos del catálogo base (empresa, no eliminados). El cliente lo usa como contador exacto en vez de inferirlo de los deltas.',
    example: 142,
  })
  total?: number;
}
