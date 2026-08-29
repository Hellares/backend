import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { OPERACIONES_AUTORIZABLES } from '../services/operaciones-autorizables.catalog';

export class AutorizarOperacionDto {
  @ApiProperty({ description: 'DNI del administrador que autoriza' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ description: 'Contraseña del administrador' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    description:
      'Tipo de operacion a autorizar. Tiene que estar en el catálogo ' +
      '(`operaciones-autorizables.catalog.ts`); una operación desconocida se ' +
      'rechaza con 400. Se aceptan alias viejos por compatibilidad con APKs ' +
      'en la calle (`DESCUENTO` → `APLICAR_DESCUENTO`), y el servidor registra ' +
      'siempre el nombre canónico.',
    example: 'ANULAR_VENTA',
    enum: OPERACIONES_AUTORIZABLES,
  })
  @IsString()
  @IsNotEmpty()
  operacion: string;

  @ApiPropertyOptional({ description: 'Motivo de la operacion' })
  @IsOptional()
  @IsString()
  motivo?: string;
}
