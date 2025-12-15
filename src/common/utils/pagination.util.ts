import { ApiProperty } from '@nestjs/swagger';

/**
 * Metadata de paginación extendida
 */
export class PaginationMeta {
  @ApiProperty({ description: 'Total de registros' })
  total: number;

  @ApiProperty({ description: 'Página actual (1-indexed)' })
  page: number;

  @ApiProperty({ description: 'Tamaño de página (límite de registros)' })
  pageSize: number;

  @ApiProperty({ description: 'Total de páginas' })
  totalPages: number;

  @ApiProperty({ description: 'Offset actual (0-indexed)' })
  offset: number;

  @ApiProperty({ description: 'Límite de registros (alias de pageSize)' })
  limit: number;

  @ApiProperty({ description: 'Offset de la página siguiente', nullable: true })
  nextOffset: number | null;

  @ApiProperty({ description: 'Offset de la página anterior', nullable: true })
  prevOffset: number | null;

  @ApiProperty({ description: 'Indica si hay página siguiente' })
  hasNext: boolean;

  @ApiProperty({ description: 'Indica si hay página anterior' })
  hasPrevious: boolean;
}

/**
 * Respuesta paginada genérica
 */
export class PaginatedResponse<T> {
  @ApiProperty({ description: 'Datos de la página actual', type: [Object] })
  data: T[];

  @ApiProperty({ description: 'Metadata de paginación', type: PaginationMeta })
  meta: PaginationMeta;
}

/**
 * Genera metadata de paginación completa
 *
 * @param total - Total de registros en la base de datos
 * @param page - Página actual (1-indexed)
 * @param pageSize - Tamaño de página
 * @returns Metadata de paginación completa
 */
export function generatePaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  const safeOffset = (page - 1) * pageSize;

  return {
    total,
    page,
    pageSize,
    totalPages,
    offset: safeOffset,
    limit: pageSize,
    nextOffset: page < totalPages ? safeOffset + pageSize : null,
    prevOffset: page > 1 ? safeOffset - pageSize : null,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

/**
 * Crea una respuesta paginada
 *
 * @param data - Array de datos de la página
 * @param total - Total de registros
 * @param page - Página actual
 * @param pageSize - Tamaño de página
 * @returns Respuesta paginada con metadata
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  return {
    data,
    meta: generatePaginationMeta(total, page, pageSize),
  };
}
