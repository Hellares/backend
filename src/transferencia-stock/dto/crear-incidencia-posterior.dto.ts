import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsInt, Min, IsOptional, IsArray } from 'class-validator';
import { TipoIncidenciaTransferencia } from './recibir-transferencia-con-incidencias.dto';

/**
 * DTO para crear una incidencia DESPUÉS de haber recibido una transferencia
 * Útil para reportar problemas encontrados al abrir/verificar cajas después de la recepción inicial
 */
export class CrearIncidenciaPosteriorDto {
  @ApiProperty({
    description: 'ID del item de la transferencia que tiene el problema',
    example: 'cmktqbpjo000501mqvkfskqc7',
  })
  @IsString()
  itemId: string;

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
    description: 'Descripción detallada del problema encontrado',
    example: 'Al abrir las cajas se encontraron 2 unidades con daños internos',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'URLs de archivos de evidencia (fotos, PDFs). Deben ser URLs públicas de archivos ya subidos.',
    type: [String],
    example: [
      'https://res.cloudinary.com/.../evidencia1.jpg',
      'https://res.cloudinary.com/.../evidencia2.jpg',
    ],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenciasUrls?: string[];

  @ApiPropertyOptional({
    description: 'Observaciones adicionales sobre la incidencia',
    example: 'Se notificó al proveedor sobre el problema',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
