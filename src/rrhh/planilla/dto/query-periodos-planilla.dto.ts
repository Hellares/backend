import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoPeriodoPlanilla } from '@prisma/client';

export class QueryPeriodosPlanillaDto {
  @ApiPropertyOptional({
    description: 'Filtrar por año',
    example: 2026,
  })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Type(() => Number)
  anio?: number;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del periodo',
    enum: EstadoPeriodoPlanilla,
    example: EstadoPeriodoPlanilla.BORRADOR,
  })
  @IsOptional()
  @IsEnum(EstadoPeriodoPlanilla, { message: 'Estado de periodo inválido' })
  estado?: EstadoPeriodoPlanilla;

  @ApiPropertyOptional({
    description: 'Página actual',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
