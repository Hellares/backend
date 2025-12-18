import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateClienteDto {
  @ApiProperty({
    description: 'DNI del cliente (8 dígitos, obligatorio)',
    example: '12345678',
  })
  @IsString()
  @IsNotEmpty({ message: 'El DNI es obligatorio' })
  @Length(8, 8, { message: 'El DNI debe tener exactamente 8 dígitos' })
  @Matches(/^\d{8}$/, { message: 'El DNI debe contener solo números' })
  dni: string;

  @ApiProperty({
    description: 'Nombres del cliente',
    example: 'Juan Carlos',
  })
  @IsString()
  @IsNotEmpty({ message: 'Los nombres son obligatorios' })
  @MaxLength(100, { message: 'Los nombres no pueden exceder 100 caracteres' })
  nombres: string;

  @ApiProperty({
    description: 'Apellidos del cliente',
    example: 'Pérez García',
  })
  @IsString()
  @IsNotEmpty({ message: 'Los apellidos son obligatorios' })
  @MaxLength(100, { message: 'Los apellidos no pueden exceder 100 caracteres' })
  apellidos: string;

  @ApiProperty({
    description: 'Teléfono del cliente (obligatorio)',
    example: '987654321',
  })
  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @Matches(/^\d{9}$/, { message: 'El teléfono debe tener 9 dígitos' })
  telefono: string;

  @ApiPropertyOptional({
    description: 'Email del cliente (opcional)',
    example: 'juan.perez@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    description: 'Dirección del cliente',
    example: 'Av. Ejemplo 123, Lima',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string;

  @ApiPropertyOptional({
    description: 'Distrito del cliente',
    example: 'Miraflores',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  distrito?: string;

  @ApiPropertyOptional({
    description: 'Provincia del cliente',
    example: 'Lima',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provincia?: string;

  @ApiPropertyOptional({
    description: 'Departamento del cliente',
    example: 'Lima',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departamento?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre el cliente',
    example: 'Cliente frecuente, prefiere entregas por las tardes',
  })
  @IsOptional()
  @IsString()
  notas?: string;
}
