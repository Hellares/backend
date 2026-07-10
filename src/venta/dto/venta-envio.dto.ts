import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Datos del despacho de una venta CON ENVÍO (rótulo de agencia). */
export class VentaEnvioDto {
  @ApiProperty({ example: 'MARIA LOPEZ TORRES' })
  @IsString()
  @IsNotEmpty()
  destinatarioNombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinatarioDni?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinatarioCelular?: string;

  @ApiPropertyOptional({ example: 'SHALOM' })
  @IsOptional()
  @IsString()
  agenciaNombre?: string;

  @ApiPropertyOptional({ example: 'San Martín' })
  @IsOptional()
  @IsString()
  destinoDepartamento?: string;

  @ApiPropertyOptional({ example: 'Tarapoto' })
  @IsOptional()
  @IsString()
  destinoProvincia?: string;

  @ApiPropertyOptional({ example: 'Jr. Los Pinos 123' })
  @IsOptional()
  @IsString()
  agenciaDireccion?: string;
}
