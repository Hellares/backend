import { ApiProperty } from '@nestjs/swagger';
import { FrecuenciaGasto } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';

export class CrearGastoRecurrenteDto {
  @ApiProperty({ example: 'Recibo Luz local SJL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @ApiProperty({ description: 'FK CategoriaGasto (tipo=EGRESO)' })
  @IsString()
  @IsNotEmpty()
  categoriaGastoId: string;

  @ApiProperty({ required: false, description: 'FK Sede; null = empresa global' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({ required: false, description: 'FK Proveedor (Luz del Sur, Sedapal, etc.)' })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiProperty({ example: 320.5, description: 'Monto referencial; el real se captura al pagar' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoEstimado: number;

  @ApiProperty({ enum: FrecuenciaGasto })
  @IsEnum(FrecuenciaGasto)
  frecuencia: FrecuenciaGasto;

  @ApiProperty({ example: 15, minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  diaVencimiento: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}
