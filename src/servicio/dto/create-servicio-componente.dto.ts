import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoAccionComponente } from '@prisma/client';

export class CreateServicioComponenteDto {
  @ApiProperty({ description: 'ID del componente' })
  @IsString()
  @IsNotEmpty()
  componenteId: string;

  @ApiProperty({
    description: 'Tipo de acción',
    enum: TipoAccionComponente,
  })
  @IsEnum(TipoAccionComponente)
  tipoAccion: TipoAccionComponente;

  @ApiPropertyOptional({ description: 'Descripción de la acción' })
  @IsOptional()
  @IsString()
  descripcionAccion?: string;

  @ApiPropertyOptional({ description: 'Detalles de la acción (JSON)' })
  @IsOptional()
  detallesAccion?: any;

  @ApiPropertyOptional({ description: 'Costo de la acción' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costoAccion?: number;

  @ApiPropertyOptional({ description: 'Tiempo de acción en minutos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  tiempoAccion?: number;

  @ApiPropertyOptional({ description: 'Costo de repuestos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costoRepuestos?: number;

  @ApiPropertyOptional({ description: 'Resultado de la acción' })
  @IsOptional()
  @IsString()
  resultadoAccion?: string;

  @ApiPropertyOptional({ description: 'Prueba realizada', default: false })
  @IsOptional()
  @IsBoolean()
  pruebaRealizada?: boolean;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Meses de garantía' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  garantiaMeses?: number;
}
