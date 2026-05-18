import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ActualizarComponenteDto {
  @ApiProperty({
    description: 'Nueva cantidad (en unidad nativa del componente)',
    required: false,
    minimum: 0.0001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @IsOptional()
  cantidad?: number;

  @ApiProperty({ description: 'Nuevas notas internas', required: false })
  @IsString()
  @IsOptional()
  notas?: string;
}
