import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Crear/actualizar el banner de la empresa (upsert, 1 por empresa). */
export class ActualizarBannerDto {
  @ApiProperty({ example: 'POR COMPRAS MAYORES A S/25 UNA MICA GRATIS' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  texto: string;

  @ApiPropertyOptional({ example: '#1565C0' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorFondo debe ser hex #RRGGBB' })
  colorFondo?: string;

  /** Color del texto; null = contraste automático según el fondo. */
  @ApiPropertyOptional({ example: '#FFFFFF', nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorTexto debe ser hex #RRGGBB' })
  colorTexto?: string | null;

  /** Color del brillo que recorre el texto; null = default del app. */
  @ApiPropertyOptional({ example: '#69F0AE', nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorBrillo debe ser hex #RRGGBB' })
  colorBrillo?: string | null;

  /** id del LottieFondo del catálogo; null = sin fondo animado. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  lottieFondoId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** La empresa solicita mostrar su banner por un pack de días. */
export class SolicitarBannerDto {
  @ApiProperty({ example: 2, description: 'Días del pack (1, 2 o 3)' })
  @IsInt()
  dias: number;
}

/** El super admin aprueba o rechaza una solicitud de banner. */
export class ResolverSolicitudBannerDto {
  @ApiProperty({ enum: ['APROBAR', 'RECHAZAR'] })
  @IsString()
  @IsNotEmpty()
  accion: 'APROBAR' | 'RECHAZAR';
}

/** Aviso del dueño de la plataforma en el slider (solo super admin). */
export class AvisoPlataformaDto {
  @ApiProperty({ example: '¡FELIZ NAVIDAD! DESCUENTOS EN TODO EL MARKETPLACE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  texto: string;

  @ApiPropertyOptional({ example: 'Syncronize', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  titulo?: string | null;

  @ApiPropertyOptional({ example: '#C62828' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorFondo debe ser hex #RRGGBB' })
  colorFondo?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorTexto debe ser hex #RRGGBB' })
  colorTexto?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorBrillo debe ser hex #RRGGBB' })
  colorBrillo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  lottieFondoId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  /** Ruta interna ("/ofertas") o URL https al tocar; null = sin acción. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  link?: string | null;

  /** ISO date; null = desde ya. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vigenciaDesde?: string | null;

  /** ISO date; null = sin vencimiento. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vigenciaHasta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  orden?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Alta de un fondo Lottie en el catálogo (solo super admin). */
export class CrearLottieFondoDto {
  @ApiProperty({ example: 'Rayito' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nombre: string;

  @ApiProperty({ example: 'https://media.syncronize.net.pe/lotties/rayito.json' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  orden?: number;

  /** Presentación: {fit, alignment, widthFactor, opacity}. null = cover full. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;
}

/** Edición de un fondo Lottie del catálogo (solo super admin). */
export class ActualizarLottieFondoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  orden?: number;

  /** Presentación: {fit, alignment, widthFactor, opacity}. null = cover full. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
