import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  Min,
  Max,
  Matches,
  ValidateIf,
} from 'class-validator';

export enum FormatoPapelDto {
  A4 = 'A4',
  TICKET_80MM = 'TICKET_80MM',
  TICKET_58MM = 'TICKET_58MM',
}

export class UpdatePlantillaDocumentoDto {
  @ApiPropertyOptional({ enum: FormatoPapelDto, description: 'Formato de papel' })
  @IsEnum(FormatoPapelDto)
  @IsOptional()
  formatoPapel?: FormatoPapelDto;

  @ApiPropertyOptional({ description: 'Margen superior en mm (0-50)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(50)
  margenSuperior?: number;

  @ApiPropertyOptional({ description: 'Margen inferior en mm (0-50)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(50)
  margenInferior?: number;

  @ApiPropertyOptional({ description: 'Margen izquierdo en mm (0-50)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(50)
  margenIzquierdo?: number;

  @ApiPropertyOptional({ description: 'Margen derecho en mm (0-50)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(50)
  margenDerecho?: number;

  @ApiPropertyOptional({ description: 'Mostrar logo de la empresa' })
  @IsBoolean()
  @IsOptional()
  mostrarLogo?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar datos de la empresa' })
  @IsBoolean()
  @IsOptional()
  mostrarDatosEmpresa?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar datos del cliente' })
  @IsBoolean()
  @IsOptional()
  mostrarDatosCliente?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar detalles/items' })
  @IsBoolean()
  @IsOptional()
  mostrarDetalles?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar totales' })
  @IsBoolean()
  @IsOptional()
  mostrarTotales?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar observaciones' })
  @IsBoolean()
  @IsOptional()
  mostrarObservaciones?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar condiciones' })
  @IsBoolean()
  @IsOptional()
  mostrarCondiciones?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar seccion de firma' })
  @IsBoolean()
  @IsOptional()
  mostrarFirma?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar codigo QR' })
  @IsBoolean()
  @IsOptional()
  mostrarCodigoQR?: boolean;

  @ApiPropertyOptional({ description: 'Mostrar pie de pagina' })
  @IsBoolean()
  @IsOptional()
  mostrarPiePagina?: boolean;

  @ApiPropertyOptional({
    description: 'Color de encabezado override (null = usa el de configuracion global)',
    example: '#1565C0',
  })
  @ValidateIf((o) => o.colorEncabezado !== null)
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'colorEncabezado debe ser un color hex valido (#RRGGBB)',
  })
  colorEncabezado?: string | null;

  @ApiPropertyOptional({
    description: 'Color de cuerpo override (null = usa el de configuracion global)',
    example: '#333333',
  })
  @ValidateIf((o) => o.colorCuerpo !== null)
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'colorCuerpo debe ser un color hex valido (#RRGGBB)',
  })
  colorCuerpo?: string | null;
}
