import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryLibroContableDto {
  @ApiProperty({ example: 3, description: 'Mes (1-12)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @ApiProperty({ example: 2026, description: 'Año' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  anio: number;
}
