import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MetodoPagoVenta } from '@prisma/client';

class ConteoMetodoPagoDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty()
  @IsNumber()
  conteoFisico: number;
}

export class CerrarCajaDto {
  @ApiProperty({ type: [ConteoMetodoPagoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConteoMetodoPagoDto)
  conteos: ConteoMetodoPagoDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    description:
      'Desglose de billetes/monedas del EFECTIVO contado al cerrar. ' +
      'Map { "200": 5, "100": 10, ..., "0.10": 30 }. La suma debe ' +
      'coincidir con el conteoFisico del EFECTIVO (tolerancia 1 centavo).',
    example: { '100': 1, '50': 2, '10': 3 },
  })
  @IsOptional()
  @IsObject()
  desgloseEfectivo?: Record<string, number>;
}
