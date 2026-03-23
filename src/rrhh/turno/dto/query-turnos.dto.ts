import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryTurnosDto {
  @ApiProperty({
    description: 'Filtrar por estado activo',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isActive?: boolean;

  @ApiProperty({
    description: 'Buscar por nombre',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}
