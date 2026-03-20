import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class AgregarCarritoDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsString()
  productoId: string;

  @ApiProperty({ description: 'ID de la variante (opcional)', required: false })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({ description: 'Cantidad', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number = 1;
}

export class ActualizarCantidadDto {
  @ApiProperty({ description: 'Nueva cantidad' })
  @IsInt()
  @Min(1)
  cantidad: number;
}
