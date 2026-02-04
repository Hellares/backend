import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ReservarStockComboDto {
  @ApiProperty({ description: 'Cantidad total de combos a reservar (0 para liberar)' })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  cantidad: number;
}
