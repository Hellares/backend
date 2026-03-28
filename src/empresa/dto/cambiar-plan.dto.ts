import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum PeriodoPago {
  MENSUAL = 'MENSUAL',
  SEMESTRAL = 'SEMESTRAL',
  ANUAL = 'ANUAL',
}

export class CambiarPlanDto {
  @ApiProperty({
    description: 'ID del plan de suscripción al que se desea cambiar',
    example: 'clx1234567890abcdefghij',
  })
  @IsString()
  @IsNotEmpty({ message: 'El ID del plan es requerido' })
  planId: string;

  @ApiProperty({
    description: 'Periodo de pago seleccionado',
    enum: PeriodoPago,
    default: PeriodoPago.MENSUAL,
  })
  @IsOptional()
  @IsEnum(PeriodoPago, { message: 'Periodo debe ser MENSUAL, SEMESTRAL o ANUAL' })
  periodo?: PeriodoPago = PeriodoPago.MENSUAL;
}
