import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Rol } from '@prisma/client';

export class AdminUsuarioFiltersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(Rol)
  rolGlobal?: Rol;

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
}
