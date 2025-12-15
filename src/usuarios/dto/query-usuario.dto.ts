import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsString, IsBoolean, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { Rol } from '@prisma/client';

export class QueryUsuarioDto {
  @ApiPropertyOptional({ description: 'Número de página', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Registros por página', default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Búsqueda por email, teléfono o nombre' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado activo', type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filtrar por email verificado', type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  emailVerificado?: boolean;

  @ApiPropertyOptional({ description: 'Filtrar por rol global', enum: Rol })
  @IsOptional()
  @IsEnum(Rol)
  rolGlobal?: Rol;

  @ApiPropertyOptional({ description: 'Filtrar por empresa ID' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}
