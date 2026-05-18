import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CrearComponenteDto {
  @ApiProperty({
    description: 'ID del producto que se usará como insumo/componente',
    example: 'cmoxyz...',
  })
  @IsString()
  @IsNotEmpty()
  componenteId!: string;

  @ApiProperty({
    description:
      'Cantidad del componente requerida por unidad del producto final. En unidad nativa del componente (0.05 si es KG y usas 50g, 0.30 si es M y usas 30cm).',
    example: 0.05,
    minimum: 0.0001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'La cantidad debe ser mayor a 0' })
  cantidad!: number;

  @ApiProperty({
    description: 'Notas internas (ej: "tamaño S/M/L")',
    required: false,
  })
  @IsString()
  @IsOptional()
  notas?: string;
}
