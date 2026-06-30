import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';

export enum EstadoCuentaPagar {
  PENDIENTE = 'PENDIENTE',
  VENCIDA = 'VENCIDA',
  PAGADA = 'PAGADA',
}

export class QueryCuentasPagarDto {
  @ApiProperty({ required: false, enum: EstadoCuentaPagar })
  @IsOptional()
  @IsEnum(EstadoCuentaPagar)
  estado?: EstadoCuentaPagar;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiProperty({ required: false, description: 'Filtra por la sede de la compra (multi-sede).' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
