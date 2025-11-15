import {
  IsString,
  IsOptional,
  IsEmail,
  MaxLength,
  MinLength,
  Matches,
  IsNotEmpty
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmpresaDto {
  @ApiProperty({
    description: 'Nombre de la empresa',
    example: 'Mi Empresa S.A.C.',
    minLength: 2,
    maxLength: 100
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede tener más de 100 caracteres' })
  nombre: string;

  @ApiPropertyOptional({
    description: 'RUC de la empresa (11 dígitos)',
    example: '20123456789',
    pattern: '^[0-9]{11}$'
  })
  @IsString()
  @IsOptional()
  @Matches(/^[0-9]{11}$/, { message: 'El RUC debe tener exactamente 11 dígitos numéricos' })
  ruc?: string;

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
}