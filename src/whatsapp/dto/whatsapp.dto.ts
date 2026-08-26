import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
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

/**
 * Un mensaje suelto al WhatsApp de un cliente, desde el número de la empresa.
 *
 * Es la misma capacidad que ya usa el bot, expuesta para que el sistema pueda
 * escribirle a un cliente sobre su orden sin salir de la app.
 */
export class EnviarMensajeWhatsappDto {
  @ApiProperty({
    description:
      'Celular del destinatario. Se normaliza acá: un celular peruano de 9 dígitos recibe el 51.',
    example: '987654321',
  })
  @IsString()
  @IsNotEmpty()
  numero: string;

  @ApiProperty({
    description: 'Texto del mensaje. Admite el formato de WhatsApp (*negrita*).',
  })
  @IsString()
  @IsNotEmpty()
  // Tope de WhatsApp para un mensaje de texto. Sin esto, un pegado accidental
  // de algo enorme se va al proveedor y vuelve como un error opaco.
  @MaxLength(4096)
  mensaje: string;
}

/**
 * Una imagen al WhatsApp del cliente, desde el número de la empresa.
 *
 * La imagen viaja en base64 y NO se guarda en ningún lado: va directo al
 * proveedor. Si algún día hay que conservarla, el camino es el
 * media-processor y un `Archivo`, no engordar este endpoint.
 */
export class EnviarImagenWhatsappDto {
  @ApiProperty({ description: 'Celular del destinatario', example: '987654321' })
  @IsString()
  @IsNotEmpty()
  numero: string;

  @ApiProperty({
    description:
      'Imagen en base64 SIN el prefijo data:. El app la redimensiona antes de mandarla.',
  })
  @IsString()
  @IsNotEmpty()
  // ~8 MB de base64 ≈ 6 MB de imagen. Muy por encima de lo que manda el app
  // (1600px al 70%, unos 300 KB) y muy por debajo de volverse un problema.
  @MaxLength(8_000_000)
  base64: string;

  @ApiPropertyOptional({
    description: 'Texto que acompaña a la imagen (el mensaje redactado).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  caption?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/, {
    message: 'mimetype debe ser image/jpeg, image/png o image/webp',
  })
  mimetype?: string;
}
