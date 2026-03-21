import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsDateString } from 'class-validator';

export class QueryResumenFinancieroDto {
  @ApiProperty({ required: false, example: '2026-03-01' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiProperty({ required: false, example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}
