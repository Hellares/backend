import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsDateString, Min } from 'class-validator';

export class CrearMetaFinancieraDto {
  @ApiProperty({ example: 'VENTAS', description: 'VENTAS | INGRESOS | AHORRO | REDUCCION_GASTOS' })
  @IsString()
  tipo: string;

  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  montoMeta: number;

  @ApiProperty({ required: false, default: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiProperty()
  @IsDateString()
  fechaInicio: string;

  @ApiProperty()
  @IsDateString()
  fechaFin: string;
}
