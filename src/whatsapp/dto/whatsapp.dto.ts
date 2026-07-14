import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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
    description:
      'Celular al que los clientes YAPEAN (9 dígitos). No siempre es el ' +
      "número vinculado por WhatsApp. '' = quitar (fallback: celular de " +
      'la integración Yape → número vinculado).',
    example: '901168935',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(9\d{8})?$/, {
    message: 'numeroPago debe ser un celular de 9 dígitos (empieza en 9)',
  })
  numeroPago?: string;

  @ApiPropertyOptional({
    description: 'Apagar/encender los envíos automáticos sin desvincular',
  })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
