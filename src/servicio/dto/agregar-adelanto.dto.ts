import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** Nuevo abono de adelanto (ACUMULATIVO: se suma al total, nunca reemplaza). */
export class AgregarAdelantoDto {
  @ApiProperty({ example: 50.0, description: 'Monto del abono (> 0)' })
  @IsNumber()
  @IsPositive()
  monto: number;

  @ApiPropertyOptional({ example: 'YAPE', default: 'EFECTIVO' })
  @IsOptional()
  @IsIn(['EFECTIVO', 'YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'])
  metodoPago?: string;

  @ApiPropertyOptional({ example: 'Segundo abono al aprobar repuesto' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nota?: string;
}
