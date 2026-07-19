import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

const MODOS = ['SOLO_CONSULTA', 'VENDE'] as const;
const TIPOS_PROVEEDOR = ['claude', 'openai', 'gemini'] as const;

/**
 * Datos que la EMPRESA puede editar de su agente IA. Los campos de control del
 * super admin (proveedorAprobado, modeloProveedor, maxProductosMostrar) NO
 * están aquí: se gestionan por un flujo aparte. El secreto (proveedorApiKey)
 * solo se actualiza si viene con valor no vacío — el form lo deja en blanco
 * para conservarlo.
 */
export class UpdateIaConfigDto {
  @ApiPropertyOptional({ description: 'Switch maestro del agente (kill switch)' })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;

  @ApiPropertyOptional({ description: 'Nombre del agente', example: 'Sofía' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nombreAgente?: string;

  @ApiPropertyOptional({
    description: 'Personalidad/tono del agente (Capa B). Máx 500 caracteres.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  promptPersonalidad?: string;

  @ApiPropertyOptional({ description: 'Mensaje de bienvenida' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  mensajeBienvenida?: string;

  @ApiPropertyOptional({ description: 'Alcance', enum: MODOS })
  @IsOptional()
  @IsIn(MODOS as unknown as string[])
  modo?: (typeof MODOS)[number];

  @ApiPropertyOptional({ description: 'Si el agente puede generar cobros Yape' })
  @IsOptional()
  @IsBoolean()
  puedeCobrarYape?: boolean;

  @ApiPropertyOptional({ description: 'Si deriva a un humano cuando no puede resolver' })
  @IsOptional()
  @IsBoolean()
  escalarAHumano?: boolean;

  @ApiPropertyOptional({ description: 'Horario de atención (texto libre)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  horarioTexto?: string;

  // — Proveedor propio (BYOK) —
  @ApiPropertyOptional({ description: 'Si la empresa usa su propio proveedor de IA' })
  @IsOptional()
  @IsBoolean()
  proveedorPropio?: boolean;

  @ApiPropertyOptional({ description: 'Proveedor', enum: TIPOS_PROVEEDOR })
  @IsOptional()
  @IsIn(TIPOS_PROVEEDOR as unknown as string[])
  proveedorTipo?: (typeof TIPOS_PROVEEDOR)[number];

  @ApiPropertyOptional({ description: 'Modelo específico del proveedor' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  proveedorModelo?: string;

  @ApiPropertyOptional({
    description: 'API key del proveedor propio. Dejar vacío para conservar la actual.',
  })
  @IsOptional()
  @IsString()
  proveedorApiKey?: string;
}

/**
 * Respuesta segura: NUNCA expone la API key completa, solo una máscara
 * (prefijo + últimos 4). `proveedorAprobado` refleja si el super admin ya la
 * validó — cambiar la key/proveedor lo resetea a false.
 */
export class IaConfigResponseDto {
  @ApiProperty({ description: 'Si existe configuración para la empresa' })
  configurado: boolean;

  @ApiProperty() habilitado: boolean;

  @ApiProperty({ nullable: true }) nombreAgente: string | null;
  @ApiProperty({ nullable: true }) promptPersonalidad: string | null;
  @ApiProperty({ nullable: true }) mensajeBienvenida: string | null;

  @ApiProperty({ enum: MODOS }) modo: (typeof MODOS)[number];
  @ApiProperty() puedeCobrarYape: boolean;
  @ApiProperty() escalarAHumano: boolean;
  @ApiProperty({ nullable: true }) horarioTexto: string | null;

  @ApiProperty() proveedorPropio: boolean;
  @ApiProperty({ nullable: true }) proveedorTipo: string | null;
  @ApiProperty({ nullable: true }) proveedorModelo: string | null;

  @ApiProperty({ description: 'API key enmascarada (sk-ant…a1b2)', nullable: true })
  proveedorApiKeyMask: string | null;

  @ApiProperty({ description: 'Si el super admin ya aprobó el proveedor propio' })
  proveedorAprobado: boolean;

  @ApiProperty({ description: 'Modelo global por defecto (control del super admin)', nullable: true })
  modeloProveedor: string | null;

  @ApiProperty() maxProductosMostrar: number;

  @ApiProperty({ nullable: true }) actualizadoEn: Date | null;
}
