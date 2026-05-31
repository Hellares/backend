import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsInt,
  IsDecimal,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoDocumentoIdentidad, TerminosPago, TipoCuenta } from '@prisma/client';

export class CreateProveedorContactoDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  cargo?: string;

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

export class CreateProveedorBancoDto {
  @IsString()
  nombreBanco: string;

  @IsEnum(TipoCuenta)
  tipoCuenta: TipoCuenta;

  @IsString()
  numeroCuenta: string;

  @IsOptional()
  @IsString()
  cci?: string;

  @IsOptional()
  @IsString()
  swift?: string;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class CreateProveedorDto {
  @IsOptional()
  @IsString()
  empresaId?: string;

  // Identificación
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsEnum(TipoDocumentoIdentidad)
  tipoDocumento: TipoDocumentoIdentidad;

  @IsString()
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
  @IsUrl()
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
  pais?: string;

  @IsOptional()
  @IsString()
  codigoPostal?: string;

  // Términos Comerciales
  @IsOptional()
  @IsEnum(TerminosPago)
  terminosPago?: TerminosPago;

  @IsOptional()
  @IsInt()
  @Min(0)
  diasCredito?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limiteCredito?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  descuentoPreferencial?: number;

  // Datos Adicionales
  @IsOptional()
  @IsString()
  contactoPrincipal?: string;

  @IsOptional()
  @IsString()
  cargoContacto?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  // Evaluación
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  calificacion?: number;

  // Control
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  motivoInactivo?: string;

  // Relaciones
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProveedorContactoDto)
  contactos?: CreateProveedorContactoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProveedorBancoDto)
  bancos?: CreateProveedorBancoDto[];

  // Auditoría
  @IsOptional()
  @IsString()
  creadoPor?: string;
}
