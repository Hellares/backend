import { ApiProperty } from '@nestjs/swagger';
import { FrecuenciaGasto } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params del listado de gastos recurrentes.
 *
 * Convención del proyecto: los booleans en query van como string
 * con @IsIn(['true','false']) — enableImplicitConversion global
 * rompe @Type(() => Boolean) y @Transform.
 * Ver feedback_query_dto_isactive_pattern.md
 */
export class ListarGastosRecurrentesQueryDto {
  @ApiProperty({ required: false, description: 'Filtrar por sede; "null" para gastos globales' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoriaGastoId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiProperty({ required: false, enum: FrecuenciaGasto })
  @IsOptional()
  @IsEnum(FrecuenciaGasto)
  frecuencia?: FrecuenciaGasto;

  @ApiProperty({ required: false, description: '"true" | "false"' })
  @IsOptional()
  @IsIn(['true', 'false'])
  activo?: string;
}
