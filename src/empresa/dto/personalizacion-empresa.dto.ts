import { IsString, IsBoolean, IsOptional, IsArray, IsHexColor, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PersonalizacionEmpresaDto {
  @ApiPropertyOptional({
    description: 'Configuración JSON personalizada para la web',
    example: { customField: 'value' },
  })
  @IsOptional()
  webConfig?: any;

  @ApiPropertyOptional({
    description: 'URL del banner principal',
    example: 'https://mi-empresa.com/banner.jpg',
  })
  @IsOptional()
  @IsUrl()
  bannerPrincipalUrl?: string;

  @ApiPropertyOptional({
    description: 'Texto del banner principal',
    example: '¡Bienvenidos a nuestra empresa!',
  })
  @IsOptional()
  @IsString()
  bannerPrincipalTexto?: string;

  @ApiPropertyOptional({
    description: 'Color del banner en formato hexadecimal',
    example: '#000000',
  })
  @IsOptional()
  @IsHexColor()
  bannerColor?: string;

  @ApiPropertyOptional({
    description: 'Color primario del tema en formato hexadecimal',
    example: '#007bff',
  })
  @IsOptional()
  @IsHexColor()
  colorPrimario?: string;

  @ApiPropertyOptional({
    description: 'Color secundario del tema en formato hexadecimal',
    example: '#6c757d',
  })
  @IsOptional()
  @IsHexColor()
  colorSecundario?: string;

  @ApiPropertyOptional({
    description: 'Color de acento en formato hexadecimal',
    example: '#28a745',
  })
  @IsOptional()
  @IsHexColor()
  colorAcento?: string;

  @ApiPropertyOptional({
    description: 'Mostrar precios públicamente',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  mostrarPrecios?: boolean;

  @ApiPropertyOptional({
    description: 'IDs de productos destacados',
    example: ['prod1', 'prod2', 'prod3'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  productosDestacados?: string[];

  @ApiPropertyOptional({
    description: 'IDs de servicios destacados',
    example: ['serv1', 'serv2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  serviciosDestacados?: string[];

  @ApiPropertyOptional({
    description: 'Mostrar información de contacto',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  mostrarContacto?: boolean;

  @ApiPropertyOptional({
    description: 'Mostrar redes sociales',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  mostrarRedesSociales?: boolean;

  @ApiPropertyOptional({
    description: 'Permitir registro de usuarios',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  permitirRegistro?: boolean;

  @ApiPropertyOptional({
    description: 'Configuración JSON personalizada para la app',
    example: { customField: 'value' },
  })
  @IsOptional()
  appConfig?: any;

  @ApiPropertyOptional({
    description: 'URL del splash screen de la app',
    example: 'https://mi-empresa.com/splash.jpg',
  })
  @IsOptional()
  @IsUrl()
  appSplashScreenUrl?: string;

  @ApiPropertyOptional({
    description: 'Color del tema de la app en formato hexadecimal',
    example: '#007bff',
  })
  @IsOptional()
  @IsHexColor()
  appColorTema?: string;

  @ApiPropertyOptional({
    description: 'Dominio personalizado',
    example: 'www.miempresa.com',
  })
  @IsOptional()
  @IsString()
  dominioPersonalizado?: string;
}

export class PersonalizacionEmpresaResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiPropertyOptional()
  webConfig?: any;

  @ApiPropertyOptional()
  bannerPrincipalUrl?: string;

  @ApiPropertyOptional()
  bannerPrincipalTexto?: string;

  @ApiPropertyOptional()
  bannerColor?: string;

  @ApiPropertyOptional()
  colorPrimario?: string;

  @ApiPropertyOptional()
  colorSecundario?: string;

  @ApiPropertyOptional()
  colorAcento?: string;

  @ApiPropertyOptional()
  mostrarPrecios?: boolean;

  @ApiPropertyOptional({ type: [String] })
  productosDestacados?: string[];

  @ApiPropertyOptional({ type: [String] })
  serviciosDestacados?: string[];

  @ApiPropertyOptional()
  mostrarContacto?: boolean;

  @ApiPropertyOptional()
  mostrarRedesSociales?: boolean;

  @ApiPropertyOptional()
  permitirRegistro?: boolean;

  @ApiPropertyOptional()
  appConfig?: any;

  @ApiPropertyOptional()
  appSplashScreenUrl?: string;

  @ApiPropertyOptional()
  appColorTema?: string;

  @ApiPropertyOptional()
  dominioPersonalizado?: string;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;
}
