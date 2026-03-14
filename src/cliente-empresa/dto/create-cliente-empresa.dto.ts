import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoDocumentoIdentidad } from '@prisma/client';

export class CreateClienteEmpresaContactoDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  cargo?: string;

  @IsOptional()
  @IsString()
  dni?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  telefonoMovil?: string;

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class CreateClienteEmpresaDto {
  @IsOptional()
  @IsString()
  empresaId?: string;

  // Identificación
  @IsString()
  razonSocial: string;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsOptional()
  @IsEnum(TipoDocumentoIdentidad)
  tipoDocumento?: TipoDocumentoIdentidad;

  @IsString()
  @Matches(/^\d{8,11}$/, { message: 'El número de documento debe tener entre 8 y 11 dígitos numéricos' })
  numeroDocumento: string;

  // Información de Contacto
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  telefonoAlternativo?: string;

  @IsOptional()
  @IsString()
  sitioWeb?: string;

  // Dirección
  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  departamento?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  @IsOptional()
  @IsString()
  pais?: string;

  // Datos SUNAT
  @IsOptional()
  @IsString()
  estadoContribuyente?: string;

  @IsOptional()
  @IsString()
  condicionContribuyente?: string;

  @IsOptional()
  @IsString()
  ubigeo?: string;

  // Datos Adicionales
  @IsOptional()
  @IsString()
  notas?: string;

  // Control
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  motivoInactivo?: string;

  // Contactos
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateClienteEmpresaContactoDto)
  contactos?: CreateClienteEmpresaContactoDto[];

  // Auditoría (asignado por controller)
  @IsOptional()
  @IsString()
  creadoPor?: string;
}
