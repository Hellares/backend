import {
  IsArray,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AsignarUsuariosDto {
  @ApiProperty({
    description: 'IDs de los usuarios a asignar',
    example: ['user-1', 'user-2', 'user-3'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  usuariosIds: string[];

  @ApiPropertyOptional({
    description: 'Límite mensual de usos para estos usuarios',
    example: 5,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limiteMensualUsos?: number;
}
