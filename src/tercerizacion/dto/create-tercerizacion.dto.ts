import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** Dato adicional denormalizado incluido en la tercerización. `valor` es arbitrario
 *  (string/array/objeto) → @Allow lo deja pasar por el whitelist sin validar tipo. */
export class DatoAdicionalTercerizacionDto {
  @IsString()
  @IsNotEmpty()
  etiqueta: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @Allow()
  valor?: unknown;
}

export class CreateTercerizacionDto {
  @ApiProperty({ description: 'ID de la empresa que ejecutará el servicio' })
  @IsString()
  @IsNotEmpty()
  empresaDestinoId: string;

  @ApiProperty({ description: 'ID de la orden de servicio a tercerizar' })
  @IsString()
  @IsNotEmpty()
  ordenOrigenId: string;

  @ApiPropertyOptional({ description: 'Notas para la empresa destino' })
  @IsOptional()
  @IsString()
  notasOrigen?: string;

  @ApiPropertyOptional({ description: 'Descripción técnica del problema (sobreescribe la de la orden)' })
  @IsOptional()
  @IsString()
  descripcionProblema?: string;

  @ApiPropertyOptional({ description: 'Síntomas técnicos (sobreescribe los de la orden)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sintomas?: string[];

  @ApiPropertyOptional({
    description:
      'Datos adicionales (campos personalizados) elegidos por el origen, denormalizados ' +
      'para que el destino los renderice sin la config del origen: [{ etiqueta, valor, tipo }].',
    type: [DatoAdicionalTercerizacionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DatoAdicionalTercerizacionDto)
  datosAdicionales?: DatoAdicionalTercerizacionDto[];

  // Set by controller from header
  empresaOrigenId?: string;
}
