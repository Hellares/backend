import {
  IsString,
  IsOptional,
  IsEmail,
  MaxLength,
  MinLength,
  Matches,
  IsNotEmpty,
  IsEnum
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RubroEmpresa } from '@prisma/client';

export class CreateEmpresaDto {
  @ApiProperty({
    description: 'RUC de la empresa (11 dígitos) - Obligatorio',
    example: '20552103816',
    pattern: '^[0-9]{11}$'
  })
  @IsString()
  @IsNotEmpty({ message: 'El RUC es requerido' })
  @Matches(/^[0-9]{11}$/, { message: 'El RUC debe tener exactamente 11 dígitos numéricos' })
  ruc: string;

  @ApiProperty({
    description: 'Razón social de SUNAT',
    example: 'AGROLIGHT PERU S.A.C.',
  })
  @IsString()
  @IsNotEmpty({ message: 'La razón social es requerida' })
  @MaxLength(255, { message: 'La razón social no puede tener más de 255 caracteres' })
  razonSocial: string;

  @ApiProperty({
    description: 'Nombre comercial de la empresa (puede diferir de la razón social)',
    example: 'Mi Empresa S.A.C.',
    minLength: 2,
    maxLength: 100
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede tener más de 100 caracteres' })
  nombre: string;

  @ApiProperty({
    description: 'Condición del contribuyente en SUNAT',
    example: 'HABIDO',
  })
  @IsString()
  @IsNotEmpty({ message: 'La condición del contribuyente es requerida' })
  condicionContribuyente: string;

  @ApiPropertyOptional({
    description: 'Estado del contribuyente en SUNAT',
    example: 'ACTIVO',
  })
  @IsString()
  @IsOptional()
  estadoContribuyente?: string;

  @ApiPropertyOptional({
    description: 'Tipo de contribuyente según SUNAT',
    example: 'SOCIEDAD ANONIMA CERRADA',
  })
  @IsString()
  @IsOptional()
  tipoContribuyente?: string;

  @ApiPropertyOptional({
    description: 'Dirección fiscal completa',
    example: 'PJ. JORGE BASADRE NRO. 158 URB. POP LA UNIVERSAL 2DA ET., LIMA - LIMA - SANTA ANITA',
  })
  @IsString()
  @IsOptional()
  direccionFiscal?: string;

  @ApiPropertyOptional({ description: 'Departamento', example: 'LIMA' })
  @IsString()
  @IsOptional()
  departamento?: string;

  @ApiPropertyOptional({ description: 'Provincia', example: 'LIMA' })
  @IsString()
  @IsOptional()
  provincia?: string;

  @ApiPropertyOptional({ description: 'Distrito', example: 'SANTA ANITA' })
  @IsString()
  @IsOptional()
  distrito?: string;

  @ApiPropertyOptional({ description: 'Código de ubigeo SUNAT', example: '150137' })
  @IsString()
  @IsOptional()
  ubigeo?: string;

  @ApiPropertyOptional({
    description: 'Descripción de la empresa',
    example: 'Empresa dedicada a la venta de productos tecnológicos',
    maxLength: 500
  })
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'La descripción no puede tener más de 500 caracteres' })
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto',
    example: '+51987654321'
  })
  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'El teléfono no puede tener más de 20 caracteres' })
  telefono?: string;

  @ApiPropertyOptional({
    description: 'Email empresarial',
    example: 'contacto@miempresa.com'
  })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'Sitio web de la empresa',
    example: 'https://www.miempresa.com'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'La URL del sitio web no puede tener más de 255 caracteres' })
  web?: string;

  @ApiPropertyOptional({
    description: 'Subdominio único para la empresa (sin .com)',
    example: 'miempresa'
  })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'El subdominio debe tener al menos 3 caracteres' })
  @MaxLength(50, { message: 'El subdominio no puede tener más de 50 caracteres' })
  @Matches(/^[a-z0-9-]+$/, { message: 'El subdominio solo puede contener letras minúsculas, números y guiones' })
  subdominio?: string;

  @ApiPropertyOptional({
    description: 'URL del logo de la empresa',
    example: 'https://ejemplo.com/logo.png'
  })
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'La URL del logo no puede tener más de 500 caracteres' })
  logo?: string;

  @ApiProperty({
    description: 'Rubro o sector de la empresa',
    enum: RubroEmpresa,
    example: RubroEmpresa.TECNOLOGIA,
  })
  @IsEnum(RubroEmpresa, { message: 'El rubro debe ser uno de los valores permitidos' })
  @IsNotEmpty({ message: 'Debe seleccionar un rubro para su empresa' })
  rubro: RubroEmpresa;
}
