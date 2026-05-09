import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { Rol } from '@prisma/client';

export enum OrdenUsuario {
  NOMBRE_ASC = 'nombre_asc',
  NOMBRE_DESC = 'nombre_desc',
  RECIENTES = 'recientes',
  ANTIGUOS = 'antiguos',
}

export class QueryUsuarioDto {
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
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Búsqueda por nombre, apellido, DNI, teléfono o email',
    example: 'Juan',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Filtrar por estado: true=solo activos, false=solo inactivos (soft-deleted o Usuario.isActive=false), omitir=todos',
    example: true,
  })
  @IsOptional()
  // No usar `@Type(() => Boolean)`: Boolean("false") devuelve true porque
  // "false" es un string no vacío. Transform manual preserva undefined
  // y mapea solo los strings/booleans esperados.
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar por rol en la empresa',
    enum: Rol,
    example: Rol.CAJERO,
  })
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @ApiPropertyOptional({
    description: 'Filtrar por sede específica',
    example: 'cuid123',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Ordenamiento',
    enum: OrdenUsuario,
    example: OrdenUsuario.NOMBRE_ASC,
  })
  @IsOptional()
  @IsEnum(OrdenUsuario)
  orden?: OrdenUsuario;
}
