import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString, IsNumber, IsObject, Min, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCitaDto {
  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiPropertyOptional({ description: 'ID del técnico asignado' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente persona' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente empresa' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'Fecha de la cita (ISO date)' })
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Hora de inicio (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaInicio debe tener formato HH:mm' })
  horaInicio?: string;

  @ApiPropertyOptional({ description: 'Hora de fin (HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaFin debe tener formato HH:mm' })
  horaFin?: string;

  @ApiPropertyOptional({ description: 'Costo del servicio (mano de obra)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costoServicio?: number;

  @ApiPropertyOptional({ description: 'Descuento aplicado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Adelanto entregado por el cliente' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adelanto?: number;

  @ApiPropertyOptional({ description: 'Método de pago del adelanto' })
  @IsOptional()
  @IsString()
  metodoPagoAdelanto?: string;

  @ApiPropertyOptional({ description: 'Datos personalizados de la plantilla del servicio' })
  @IsOptional()
  @IsObject()
  datosPersonalizados?: any;

  @ApiPropertyOptional({ description: 'Notas adicionales' })
  @IsOptional()
  @IsString()
  notas?: string;
}
