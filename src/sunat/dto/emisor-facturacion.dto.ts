import { IsString, IsOptional, IsBoolean, IsObject, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearEmisorDto {
  @ApiProperty({ description: 'RUC del emisor socio (11 dígitos)' })
  @IsString()
  @Length(11, 11)
  ruc!: string;

  @ApiProperty({ description: 'Razón social del socio' })
  @IsString()
  @MaxLength(200)
  razonSocial!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccionFiscal?: string;

  @ApiPropertyOptional({ description: 'URL API del proveedor de facturación' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  proveedorRuta?: string;

  @ApiPropertyOptional({ description: 'Token del proveedor (Syncrofact: company del socio)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proveedorToken?: string;

  @ApiPropertyOptional({ description: 'Config extra del proveedor (ej. { branchId })' })
  @IsOptional()
  @IsObject()
  proveedorConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Emisor habilitado para emitir' })
  @IsOptional()
  @IsBoolean()
  facturacionActiva?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolucionSunat?: string;
}

export class ActualizarEmisorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  razonSocial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccionFiscal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  proveedorRuta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proveedorToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  proveedorConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  facturacionActiva?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolucionSunat?: string;
}
