import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCitaItemDto {
  @ApiPropertyOptional({ description: 'ID del producto del inventario (opcional)' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiProperty({ description: 'Nombre del item/producto' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional({ description: 'Descripción adicional' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({ description: 'Cantidad', default: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number = 1;

  @ApiProperty({ description: 'Precio unitario' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario: number;
}

export class UpdateCitaItemDto {
  @ApiPropertyOptional({ description: 'Nombre del item' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ description: 'Descripción' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Cantidad' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad?: number;

  @ApiPropertyOptional({ description: 'Precio unitario' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario?: number;
}
