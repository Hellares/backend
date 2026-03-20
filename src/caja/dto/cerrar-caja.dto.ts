import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
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
}
