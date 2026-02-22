import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCotizacionDetalleDto {
  @ApiPropertyOptional({ description: 'ID del producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiProperty({ description: 'Descripcion del item' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiProperty({ description: 'Cantidad', example: 1 })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario', example: 100 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario: number;

  @ApiPropertyOptional({ description: 'Descuento por linea', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Porcentaje de IGV', example: 18 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  porcentajeIGV?: number;
}
