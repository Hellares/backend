import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { TipoSede } from '@prisma/client';

export class CreateSedeDto {
  @ApiProperty({
    description: 'Nombre de la sede',
    example: 'Sede Lima Centro',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  nombre: string;

  // El código se genera automáticamente en el backend y NO puede ser especificado
  // Este campo se ignora si se envía en la petición
  @ApiPropertyOptional({
    description: 'Código único de la sede (GENERADO AUTOMÁTICAMENTE - este campo se ignora)',
    example: 'SEDE-001',
    readOnly: true,
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto de la sede',
    example: '+51 987654321',
  })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({
    description: 'Email de contacto de la sede',
    example: 'lima@miempresa.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  email?: string;

  @ApiProperty({
    description: 'Tipo de operación de la sede',
    enum: TipoSede,
    example: TipoSede.OPERATIVA_COMPLETA,
  })
  @IsEnum(TipoSede, {
    message: 'El tipo de sede debe ser OPERATIVA_COMPLETA, SOLO_ALMACEN, PUNTO_VENTA u OFICINA_ADMINISTRATIVA',
  })
  tipoSede: TipoSede;

  @ApiPropertyOptional({
    description: 'Dirección completa de la sede',
    example: 'Av. Javier Prado 123',
  })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({
    description: 'Referencia de ubicación',
    example: 'Al frente del banco',
  })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiPropertyOptional({
    description: 'Distrito',
    example: 'San Isidro',
  })
  @IsOptional()
  @IsString()
  distrito?: string;

  @ApiPropertyOptional({
    description: 'Provincia',
    example: 'Lima',
  })
  @IsOptional()
  @IsString()
  provincia?: string;

  @ApiPropertyOptional({
    description: 'Departamento',
    example: 'Lima',
  })
  @IsOptional()
  @IsString()
  departamento?: string;

  @ApiPropertyOptional({
    description: 'País',
    example: 'PERU',
    default: 'PERU',
  })
  @IsOptional()
  @IsString()
  pais?: string;

  @ApiPropertyOptional({
    description: 'Coordenadas geográficas',
    example: { lat: -12.0464, lon: -77.0428 },
  })
  @IsOptional()
  @IsObject()
  coordenadas?: {
    lat: number;
    lon: number;
  };

  @ApiPropertyOptional({
    description: 'Horario de atención en formato JSON',
    example: {
      lunes: { inicio: '09:00', fin: '18:00' },
      martes: { inicio: '09:00', fin: '18:00' },
      miercoles: { inicio: '09:00', fin: '18:00' },
      jueves: { inicio: '09:00', fin: '18:00' },
      viernes: { inicio: '09:00', fin: '18:00' },
      sabado: { inicio: '09:00', fin: '13:00' },
    },
  })
  @IsOptional()
  @IsObject()
  horarioAtencion?: any;

  @ApiPropertyOptional({
    description: 'Configuraciones específicas de la sede',
    example: {},
  })
  @IsOptional()
  @IsObject()
  configuracion?: any;

  @ApiPropertyOptional({
    description: 'Serie para facturas',
    example: 'F002',
    default: 'F001',
  })
  @IsOptional()
  @IsString()
  serieFactura?: string;

  @ApiPropertyOptional({
    description: 'Serie para boletas',
    example: 'B002',
    default: 'B001',
  })
  @IsOptional()
  @IsString()
  serieBoleta?: string;

  @ApiPropertyOptional({
    description: 'Serie para notas de crédito',
    example: 'NC02',
    default: 'NC01',
  })
  @IsOptional()
  @IsString()
  serieNotaCredito?: string;

  @ApiPropertyOptional({
    description: 'Serie para notas de débito',
    example: 'ND02',
    default: 'ND01',
  })
  @IsOptional()
  @IsString()
  serieNotaDebito?: string;

  @ApiPropertyOptional({
    description: 'Serie para guías de remisión',
    example: 'GR02',
    default: 'GR01',
  })
  @IsOptional()
  @IsString()
  serieGuiaRemision?: string;

  @ApiPropertyOptional({
    description: 'Indica si la sede está activa',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
