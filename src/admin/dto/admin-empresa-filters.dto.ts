import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EstadoSuscripcion } from '@prisma/client';

export class AdminEmpresaFiltersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(EstadoSuscripcion)
  estadoSuscripcion?: EstadoSuscripcion;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'creadoEn';

  @IsOptional()
  @IsEnum({ asc: 'asc', desc: 'desc' })
  sortOrder?: 'asc' | 'desc' = 'desc';
}
