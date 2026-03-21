import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';

export enum EstadoCuentaCobrar {
  PENDIENTE = 'PENDIENTE',
  VENCIDA = 'VENCIDA',
  PAGADA = 'PAGADA',
}

export class QueryCuentasCobrarDto {
  @ApiProperty({ required: false, enum: EstadoCuentaCobrar })
  @IsOptional()
  @IsEnum(EstadoCuentaCobrar)
  estado?: EstadoCuentaCobrar;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
