import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FabricarDto {
  @ApiProperty({
    description: 'Sede donde se hará la fabricación (consume insumos y suma producto final).',
    example: 'cmoxyz...',
  })
  @IsString()
  @IsNotEmpty()
  sedeId!: string;

  @ApiProperty({
    description:
      'ID de la variante a fabricar. Obligatorio si el producto tiene variantes; omitir para productos sin variantes.',
    required: false,
  })
  @IsString()
  @IsOptional()
  varianteId?: string;

  @ApiProperty({
    description: 'Cantidad de unidades del producto final a fabricar.',
    example: 10,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  cantidad!: number;

  @ApiProperty({
    description: 'Observaciones libres del lote de producción.',
    required: false,
  })
  @IsString()
  @IsOptional()
  observaciones?: string;

  @ApiProperty({
    description:
      'Si true: SOLO descuenta los insumos (registro de producción previa cuyo stock terminado YA existe). NO suma stock al producto final ni recalcula su costo. Útil al onboarding de productos ya fabricados antes de tener el módulo.',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  soloConsumirInsumos?: boolean;

  @ApiProperty({
    description:
      'Costo de mano de obra TOTAL del lote (no por unidad). Se suma al costo de los insumos para el costo del lote y entra en el promedio ponderado del producto.',
    required: false,
    example: 150,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  costoManoObra?: number;
}
