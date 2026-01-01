import { IsOptional, IsEnum, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoDescuento } from './create-politica-descuento.dto';

export class QueryPoliticaDescuentoDto {
  @ApiPropertyOptional({
    description: 'Filtrar por tipo de descuento',
    enum: TipoDescuento,
  })
  @IsEnum(TipoDescuento)
  @IsOptional()
  tipoDescuento?: TipoDescuento;

  @ApiPropertyOptional({
    description: 'Filtrar por estado activo/inactivo',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Número de página',
    example: 1,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    description: 'Cantidad de resultados por página',
    example: 20,
    default: 20,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
