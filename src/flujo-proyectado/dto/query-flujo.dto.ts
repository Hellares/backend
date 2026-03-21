import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryFlujoProyectadoDto {
  @ApiProperty({ required: false, default: 3, description: 'Cantidad de meses a proyectar' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  meses?: number;
}
