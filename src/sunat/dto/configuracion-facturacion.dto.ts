import { IsString, IsOptional, IsBoolean, IsEmail, IsEnum, IsUrl, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfiguracionFacturacionDto {
  @ApiPropertyOptional({ description: 'URL API del proveedor de facturación' }) @IsOptional() @IsUrl() proveedorRuta?: string;
  @ApiPropertyOptional({ description: 'Token/credencial del proveedor' }) @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) proveedorToken?: string;
  @ApiPropertyOptional({ description: 'Activar facturación electrónica' }) @IsOptional() @IsBoolean() facturacionActiva?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsEmail() emailFacturacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(['BETA', 'PRODUCCION'], { message: 'Entorno debe ser BETA o PRODUCCION' }) entorno?: string;
  @ApiPropertyOptional({ example: 'No.034-005-0005315' }) @IsOptional() @IsString() @MaxLength(100) resolucionSunat?: string;
}
