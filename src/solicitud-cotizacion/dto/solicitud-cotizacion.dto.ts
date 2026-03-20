import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, ValidateNested, IsInt, IsBoolean, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SolicitudItemDto {
  @ApiProperty({ description: 'ID del producto (si es del catálogo)', required: false })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiProperty({ description: 'ID de la variante', required: false })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({ description: 'Descripción del item' })
  @IsString()
  descripcion: string;

  @ApiProperty({ description: 'Cantidad', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number = 1;

  @ApiProperty({ description: 'URL de imagen (snapshot)', required: false })
  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @ApiProperty({ description: 'Es item manual (no del catálogo)', default: false })
  @IsOptional()
  @IsBoolean()
  esManual?: boolean = false;

  @ApiProperty({ description: 'Notas del item', required: false })
  @IsOptional()
  @IsString()
  notasItem?: string;
}

export class CrearSolicitudDto {
  @ApiProperty({ description: 'ID de la empresa a solicitar' })
  @IsString()
  empresaId: string;

  @ApiProperty({ description: 'Observaciones generales', required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({ description: 'Items de la solicitud', type: [SolicitudItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SolicitudItemDto)
  items: SolicitudItemDto[];
}

export class RechazarSolicitudDto {
  @ApiProperty({ description: 'Motivo del rechazo' })
  @IsString()
  motivo: string;
}
