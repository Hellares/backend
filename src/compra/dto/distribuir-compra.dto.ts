import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DistribucionSedeDto {
  @ApiProperty({ description: 'ID de la sede destino' })
  @IsString()
  @IsNotEmpty()
  sedeDestinoId: string;

  @ApiProperty({ description: 'Cantidad a enviar a esta sede', minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad: number;
}

export class DistribucionItemDto {
  @ApiProperty({ description: 'ID del detalle de compra' })
  @IsString()
  @IsNotEmpty()
  compraDetalleId: string;

  @ApiProperty({
    description: 'Distribuciones por sede destino',
    type: [DistribucionSedeDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistribucionSedeDto)
  distribuciones: DistribucionSedeDto[];
}

export class DistribuirCompraDto {
  @ApiProperty({
    description: 'Items a distribuir con sus sedes destino',
    type: [DistribucionItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistribucionItemDto)
  items: DistribucionItemDto[];

  @ApiPropertyOptional({ description: 'Observaciones de la distribución' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
