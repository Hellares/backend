import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoArqueoCaja, MetodoPagoVenta } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ConteoMetodoDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago!: MetodoPagoVenta;

  @ApiProperty({ description: 'Monto contado fisicamente' })
  @IsNumber()
  @Min(0)
  conteoFisico!: number;
}

export class CrearArqueoDto {
  @ApiProperty({ enum: TipoArqueoCaja })
  @IsEnum(TipoArqueoCaja)
  tipo!: TipoArqueoCaja;

  @ApiProperty({ type: [ConteoMetodoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConteoMetodoDto)
  conteos!: ConteoMetodoDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    description: 'Para SORPRESIVO: id del autorizador (usualmente owner).',
  })
  @IsOptional()
  @IsString()
  autorizadoPorId?: string;

  @ApiPropertyOptional({
    description: 'Para RELEVO: id del usuario que recibe el turno.',
  })
  @IsOptional()
  @IsString()
  turnoEntregadoAId?: string;

  @ApiPropertyOptional({
    description:
      'Desglose de billetes/monedas del EFECTIVO contado. ' +
      'Map { "200": 5, "100": 10, ..., "0.10": 30 }. La suma debe ' +
      'coincidir con el conteoFisico del EFECTIVO (tolerancia 1 centavo).',
    example: { '100': 1, '50': 2, '10': 3 },
  })
  @IsOptional()
  @IsObject()
  desgloseEfectivo?: Record<string, number>;
}

