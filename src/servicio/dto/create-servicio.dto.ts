import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoServicio } from '@prisma/client';

export class CreateServicioDto {
  @ApiProperty({ description: 'ID de la empresa' })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiProperty({ description: 'Nombre del servicio', example: 'Reparación de pantalla' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre: string;

  @ApiPropertyOptional({ description: 'Descripción del servicio' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Precio base del servicio', example: 50.00 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precio?: number;

  @ApiPropertyOptional({ description: 'Precio por hora', example: 25.00 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioPorHora?: number;

  @ApiPropertyOptional({ description: 'Duración estimada en minutos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  duracionMinutos?: number;

  @ApiPropertyOptional({ description: 'Duración estimada en horas' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  duracionHoras?: number;

  @ApiPropertyOptional({
    description: 'Tipo de servicio',
    enum: TipoServicio,
  })
  @IsOptional()
  @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional({ description: 'Requiere reserva', default: false })
  @IsOptional()
  @IsBoolean()
  requiereReserva?: boolean;

  @ApiPropertyOptional({ description: 'Requiere depósito', default: false })
  @IsOptional()
  @IsBoolean()
  requiereDeposito?: boolean;

  @ApiPropertyOptional({ description: 'Porcentaje de depósito' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  depositoPorcentaje?: number;

  @ApiPropertyOptional({ description: 'Visible en marketplace', default: true })
  @IsOptional()
  @IsBoolean()
  visibleMarketplace?: boolean;

  @ApiPropertyOptional({ description: 'En oferta', default: false })
  @IsOptional()
  @IsBoolean()
  enOferta?: boolean;

  @ApiPropertyOptional({ description: 'Precio de oferta' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioOferta?: number;

  @ApiPropertyOptional({ description: 'ID de la plantilla de campos' })
  @IsOptional()
  @IsString()
  plantillaServicioId?: string;

  @ApiPropertyOptional({ description: 'ID de la sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'ID de la categoría de empresa' })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({ description: 'ID de la unidad de medida' })
  @IsOptional()
  @IsString()
  unidadMedidaId?: string;

  @ApiPropertyOptional({ description: 'URL de video' })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({ description: 'Porcentaje de impuesto' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  impuestoPorcentaje?: number;

  @ApiPropertyOptional({ description: 'Comisión del técnico (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  comisionTecnico?: number;
}
