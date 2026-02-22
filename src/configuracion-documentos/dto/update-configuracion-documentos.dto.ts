import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateConfiguracionDocumentosDto {
  @ApiPropertyOptional({ description: 'URL del logo de la empresa' })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Nombre comercial para documentos' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  nombreComercial?: string;

  @ApiPropertyOptional({ description: 'RUC de la empresa' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  ruc?: string;

  @ApiPropertyOptional({ description: 'Direccion de la empresa' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  direccion?: string;

  @ApiPropertyOptional({ description: 'Telefono de la empresa' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  telefono?: string;

  @ApiPropertyOptional({ description: 'Email de la empresa' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({
    description: 'Color primario en formato hex (#RRGGBB)',
    example: '#1565C0',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'colorPrimario debe ser un color hex valido (#RRGGBB)',
  })
  colorPrimario?: string;

  @ApiPropertyOptional({
    description: 'Color secundario en formato hex (#RRGGBB)',
    example: '#1E88E5',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'colorSecundario debe ser un color hex valido (#RRGGBB)',
  })
  colorSecundario?: string;

  @ApiPropertyOptional({
    description: 'Color de texto en formato hex (#RRGGBB)',
    example: '#333333',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'colorTexto debe ser un color hex valido (#RRGGBB)',
  })
  colorTexto?: string;

  @ApiPropertyOptional({ description: 'Texto del pie de pagina' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  textoPiePagina?: string;

  @ApiPropertyOptional({ description: 'Mostrar paginacion en el pie' })
  @IsBoolean()
  @IsOptional()
  mostrarPaginacion?: boolean;
}
