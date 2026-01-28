import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Tipos de incidencias que pueden ocurrir al recibir una transferencia
 */
export enum TipoIncidenciaTransferencia {
  FALTANTE = 'FALTANTE',
  DANADO = 'DANADO',
  CALIDAD_RECHAZADA = 'CALIDAD_RECHAZADA',
  EXCEDENTE = 'EXCEDENTE',
  EMPAQUE_DANADO = 'EMPAQUE_DANADO',
  PRODUCTO_INCORRECTO = 'PRODUCTO_INCORRECTO',
}

/**
 * DTO para reportar una incidencia específica en un item
 */
export class IncidenciaItemDto {
  @ApiProperty({
    enum: TipoIncidenciaTransferencia,
    description: 'Tipo de problema encontrado',
    example: 'DANADO',
  })
  @IsEnum(TipoIncidenciaTransferencia)
  tipo: TipoIncidenciaTransferencia;

  @ApiProperty({
    description: 'Cantidad de productos afectados por esta incidencia',
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  cantidadAfectada: number;

  @ApiPropertyOptional({
    description: 'Descripción detallada del problema',
    example: 'Cajas aplastadas por mal embalaje durante el transporte',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description:
      'URLs de archivos de evidencia (fotos, PDFs, documentos). ' +
      'Pueden ser múltiples archivos para documentar completamente el problema.',
    type: [String],
    example: [
      'https://storage.example.com/evidencias/dano_001.jpg',
      'https://storage.example.com/evidencias/dano_002.jpg',
      'https://storage.example.com/evidencias/reporte_transportista.pdf',
    ],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenciasUrls?: string[];
}

/**
 * DTO para recibir un item específico de la transferencia con sus incidencias
 */
export class RecibirItemDto {
  @ApiProperty({
    description: 'ID del item de transferencia a recibir',
    example: 'clxxx123456',
  })
  @IsString()
  itemId: string;

  @ApiProperty({
    description:
      'Cantidad recibida en buen estado y lista para venta (vendible)',
    example: 96,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  cantidadRecibidaBuenEstado: number;

  @ApiPropertyOptional({
    description:
      'Lista de incidencias encontradas al recibir este item. ' +
      'IMPORTANTE: La suma de cantidadRecibidaBuenEstado + suma(cantidadAfectada de incidencias) ' +
      'debe ser igual o menor a la cantidad enviada.',
    type: [IncidenciaItemDto],
    example: [
      {
        tipo: 'DANADO',
        cantidadAfectada: 2,
        descripcion: 'Productos con empaque dañado',
        evidenciasUrls: [
          'https://storage.example.com/foto_dano_1.jpg',
          'https://storage.example.com/foto_dano_2.jpg',
        ],
      },
      {
        tipo: 'FALTANTE',
        cantidadAfectada: 2,
        descripcion: 'No llegaron físicamente',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncidenciaItemDto)
  incidencias?: IncidenciaItemDto[];

  @ApiPropertyOptional({
    description: 'Ubicación física donde se almacenará en la sede destino',
    example: 'Pasillo A, Estante 3, Nivel 2',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;

  @ApiPropertyOptional({
    description: 'Observaciones específicas al recibir este item',
    example: 'Empaque exterior dañado pero producto intacto',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

/**
 * DTO principal para recibir una transferencia con manejo de incidencias
 * Permite recibir item por item, especificando cantidades buenas, dañadas, faltantes, etc.
 */
export class RecibirTransferenciaConIncidenciasDto {
  @ApiProperty({
    description:
      'Lista de items a recibir con sus cantidades e incidencias. ' +
      'Puedes recibir uno o varios items de la transferencia. ' +
      'Los items no incluidos quedarán pendientes de recepción.',
    type: [RecibirItemDto],
    example: [
      {
        itemId: 'clxxx123456',
        cantidadRecibidaBuenEstado: 96,
        incidencias: [
          {
            tipo: 'DANADO',
            cantidadAfectada: 2,
            descripcion: 'Cajas aplastadas, mercancía inservible',
            evidenciasUrls: [
              'https://storage.example.com/incidencias/caja_1.jpg',
              'https://storage.example.com/incidencias/caja_2.jpg',
              'https://storage.example.com/incidencias/acta_transportista.pdf',
            ],
          },
          {
            tipo: 'FALTANTE',
            cantidadAfectada: 2,
            descripcion: 'No llegaron físicamente',
          },
        ],
        ubicacion: 'Almacén A - Pasillo 3',
        observaciones: 'Verificar con transporte los faltantes',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecibirItemDto)
  items: RecibirItemDto[];

  @ApiPropertyOptional({
    description: 'Observaciones generales de toda la recepción',
    example:
      'Recepción parcial debido a problemas de transporte. Coordinando re-envío de faltantes.',
  })
  @IsOptional()
  @IsString()
  observacionesGenerales?: string;

  @ApiPropertyOptional({
    description:
      'Si es true, marca la transferencia como completamente recibida. ' +
      'Si es false o no se especifica, la transferencia quedará EN_TRANSITO permitiendo recepciones posteriores.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  marcarComoCompletada?: boolean;
}
