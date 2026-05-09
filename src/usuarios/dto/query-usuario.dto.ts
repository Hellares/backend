import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
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
      'Filtrar por estado: "true"=solo activos, "false"=solo inactivos ' +
      '(soft-deleted o Usuario.isActive=false), omitir=solo activos.',
    example: 'true',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  // Declarado como string (no boolean) porque NestJS tiene
  // `enableImplicitConversion: true` en ValidationPipe global, que
  // ejecuta `Boolean('false')` → `true` antes de cualquier @Transform.
  // El service interpreta el string en `obtenerUsuarios`.
  isActive?: string;

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
