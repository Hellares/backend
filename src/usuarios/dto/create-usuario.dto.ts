import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  Length,
  Matches,
  MaxLength,
  IsBoolean,
  IsArray,
  IsNumber,
  Min,
} from 'class-validator';
import { Rol } from '@prisma/client';

export class CreateUsuarioDto {
  // Datos de la persona
  @IsString()
  @IsNotEmpty({ message: 'El DNI es obligatorio' })
  @Length(8, 8, { message: 'El DNI debe tener 8 dígitos' })
  @Matches(/^\d{8}$/, { message: 'El DNI debe contener solo números' })
  dni: string;

  @IsString()
  @IsNotEmpty({ message: 'Los nombres son obligatorios' })
  nombres: string;

  @IsString()
  @IsNotEmpty({ message: 'Los apellidos son obligatorios' })
  apellidos: string;

  @IsEmail({}, { message: 'Debe proporcionar un email válido' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @Length(9, 9, { message: 'El teléfono debe tener 9 dígitos' })
  @Matches(/^9\d{8}$/, { message: 'El teléfono debe comenzar con 9' })
  telefono?: string;

  // Datos de dirección (opcionales)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  distrito?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provincia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  departamento?: string;

  // Datos del usuario/trabajador
  @IsEnum(Rol, { message: 'Rol inválido' })
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  rol: Rol; // VENDEDOR, CAJERO, TECNICO, CONTADOR, etc.

  // Sede(s) a asignar (opcional)
  @IsOptional()
  @IsArray()
  sedeIds?: string[]; // IDs de sedes donde trabajará

  // Configuración adicional para caja (si aplica)
  @IsBoolean()
  @IsOptional()
  puedeAbrirCaja?: boolean;

  @IsBoolean()
  @IsOptional()
  puedeCerrarCaja?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limiteCreditoVenta?: number;

  /// IDs de accesos rápidos del dashboard que el usuario NO debe ver.
  /// Vacío (default) = ver todos los accesos que su rol permita.
  /// Los IDs son los declarados en el catálogo del frontend
  /// (`accesos_rapidos_section.dart`).
  @IsOptional()
  @IsArray()
  accesosRapidosOcultos?: string[];

  // Permisos adicionales (opcional)
  @IsOptional()
  @IsArray()
  permisos?: string[];

  // Notas (opcional)
  @IsString()
  @IsOptional()
  notas?: string;
}
