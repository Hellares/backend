import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWhatsappDto {
  @ApiPropertyOptional({
    description:
      'Plantilla del mensaje "premio enviado". Variables: {saludo} {ganador} ' +
      '{premio} {agencia} {destino} {orden} {codigo} {clave} {empresa}. ' +
      'Cadena vacía = volver a la plantilla default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaPremio?: string;

  @ApiPropertyOptional({
    description:
      'Plantilla de las instrucciones de pago del bot para SORTEOS. ' +
      'Variables: {monto} {numero} {empresa}. Cadena vacía = default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaPagoSorteo?: string;

  @ApiPropertyOptional({
    description:
      'Plantilla de las instrucciones de pago del bot para DINÁMICAS. ' +
      'Variables: {monto} {numero} {empresa}. Cadena vacía = default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaPagoDinamica?: string;

  @ApiPropertyOptional({
    description:
      'Cabecera de la confirmación al validar el pago (SORTEOS). ' +
      'Variables: {nombre} {titulo} {ticket} {empresa}. Vacía = default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaConfirmacionSorteo?: string;

  @ApiPropertyOptional({
    description:
      'Cabecera de la confirmación al validar el pago (DINÁMICAS). ' +
      'Variables: {nombre} {titulo} {ticket} {empresa}. Vacía = default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaConfirmacionDinamica?: string;

  @ApiPropertyOptional({
    description:
      'Agencia con la que la empresa hace TODOS los envíos — el bot la ' +
      "informa y no pregunta. '' = volver al default (SHALOM).",
    example: 'SHALOM',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  agenciaEnvio?: string;

  @ApiPropertyOptional({
    description: 'Apagar/encender los envíos automáticos sin desvincular',
  })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
