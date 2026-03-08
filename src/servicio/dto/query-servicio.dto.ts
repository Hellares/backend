import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoServicio } from '@prisma/client';

export enum OrdenServicio {
  NOMBRE_ASC = 'nombre_asc',
  NOMBRE_DESC = 'nombre_desc',
  PRECIO_ASC = 'precio_asc',
  PRECIO_DESC = 'precio_desc',
  RECIENTES = 'recientes',
  ANTIGUOS = 'antiguos',
}

export class QueryServicioDto {
  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Elementos por página', default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Búsqueda por nombre/código/descripción' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por categoría' })
  @IsOptional()
  @IsString()
  empresaCategoriaId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de servicio',
    enum: TipoServicio,
  })
  @IsOptional()
  @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional({
    description: 'Ordenamiento',
    enum: OrdenServicio,
  })
  @IsOptional()
  @IsEnum(OrdenServicio)
  orden?: OrdenServicio;
}
