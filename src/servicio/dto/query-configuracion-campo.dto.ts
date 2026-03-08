import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { CategoriaCampo } from '@prisma/client';

export class QueryConfiguracionCampoDto {
  @ApiPropertyOptional({
    description: 'Filtrar por categoría',
    enum: CategoriaCampo,
  })
  @IsOptional()
  @IsEnum(CategoriaCampo)
  categoria?: CategoriaCampo;

  @ApiPropertyOptional({
    description: 'Filtrar por estado activo',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  activo?: boolean;
}
