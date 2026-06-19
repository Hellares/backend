import { IsString, IsOptional, IsBoolean, IsUrl } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

/**
 * Datos para crear/actualizar la integración Yape de una empresa.
 * Los secretos (accountApiKey, webhookSecret) solo se actualizan si se envían
 * con valor no vacío — así el form puede dejarlos en blanco para conservarlos.
 */
export class UpdateIntegracionYapeDto {
  @ApiPropertyOptional({
    description: 'URL base de api-yape',
    example: 'https://yape.syncronize.net.pe',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  apiBaseUrl?: string;

  @ApiPropertyOptional({
    description: 'API key de la cuenta en api-yape (acc_...). Dejar vacío para conservar la actual.',
  })
  @IsOptional()
  @IsString()
  accountApiKey?: string;

  @ApiPropertyOptional({
    description: 'ID de la cuenta en api-yape (mapea el webhook entrante a la empresa)',
  })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Secret HMAC del webhook (whsec_...). Dejar vacío para conservar el actual.',
  })
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @ApiPropertyOptional({
    description: 'Si la integración está activa',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}

/**
 * Respuesta segura: NUNCA expone los secretos completos, solo una máscara
 * (prefijo + últimos 4) para que el admin reconozca el valor sin filtrarlo.
 */
export class IntegracionYapeResponseDto {
  @ApiProperty({ description: 'Si existe configuración para la empresa' })
  configurado: boolean;

  @ApiProperty({ description: 'Si la integración está habilitada' })
  habilitado: boolean;

  @ApiProperty({ nullable: true })
  apiBaseUrl: string | null;

  @ApiProperty({ nullable: true })
  accountId: string | null;

  @ApiProperty({ description: 'accountApiKey enmascarado (acc_88aa…0753)', nullable: true })
  accountApiKeyMask: string | null;

  @ApiProperty({ description: 'webhookSecret enmascarado (whsec_1410…4ac9)', nullable: true })
  webhookSecretMask: string | null;

  @ApiProperty({ description: 'URL del webhook que debe configurarse en api-yape' })
  webhookUrl: string;

  @ApiProperty({ nullable: true })
  actualizadoEn: Date | null;
}

export class ProbarConexionResponseDto {
  @ApiProperty({ description: 'Si la conexión con api-yape funcionó' })
  ok: boolean;

  @ApiProperty({ description: 'Mensaje legible del resultado' })
  mensaje: string;
}
