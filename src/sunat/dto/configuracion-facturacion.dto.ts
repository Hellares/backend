import { IsString, IsOptional, IsBoolean, IsEmail, IsEnum, IsUrl, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfiguracionFacturacionDto {
  @ApiPropertyOptional() @IsOptional() @IsUrl() nubefactRuta?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) nubefactToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() nubefactActivo?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsEmail() emailFacturacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(['BETA', 'PRODUCCION'], { message: 'Entorno debe ser BETA o PRODUCCION' }) entorno?: string;
  @ApiPropertyOptional({ example: 'No.034-005-0005315' }) @IsOptional() @IsString() @MaxLength(100) resolucionSunat?: string;
  // ruc, razonSocial, nombreComercial, direccionFiscal, telefono, logoEmpresa eliminados
  // — se leen de Empresa (fuente primaria) + Sede (override) + ConfigDocumentos (marca)
}
