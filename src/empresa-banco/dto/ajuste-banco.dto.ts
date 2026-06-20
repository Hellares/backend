import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, IsNotEmpty, Min, MaxLength } from 'class-validator';

export class AjusteBancoDto {
  @ApiProperty({ enum: ['INGRESO', 'EGRESO'], description: 'INGRESO suma, EGRESO resta' })
  @IsEnum(['INGRESO', 'EGRESO'] as any)
  tipo: 'INGRESO' | 'EGRESO';

  @ApiProperty({ example: 12.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

  @ApiProperty({ example: 'Comisión de mantenimiento' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  motivo: string;
}
