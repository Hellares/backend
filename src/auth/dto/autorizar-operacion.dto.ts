import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AutorizarOperacionDto {
  @ApiProperty({ description: 'DNI del administrador que autoriza' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ description: 'Contraseña del administrador' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Tipo de operacion a autorizar', example: 'ANULAR_VENTA' })
  @IsString()
  @IsNotEmpty()
  operacion: string;

  @ApiPropertyOptional({ description: 'Motivo de la operacion' })
  @IsOptional()
  @IsString()
  motivo?: string;
}
