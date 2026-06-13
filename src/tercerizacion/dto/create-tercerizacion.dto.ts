import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
      'para que el destino los renderice sin la config del origen: [{ etiqueta, valor, tipo }]. ' +
      'Sin @ValidateNested a propósito: los objetos pasan intactos (valores arbitrarios).',
  })
  @IsOptional()
  @IsArray()
  datosAdicionales?: unknown[];

  // Set by controller from header
  empresaOrigenId?: string;
}
