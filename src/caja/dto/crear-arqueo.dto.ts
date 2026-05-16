import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoArqueoCaja, MetodoPagoVenta } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNumber,
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
}
