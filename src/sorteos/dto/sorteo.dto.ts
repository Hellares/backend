import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CanalSorteo,
  EstadoPremioSorteo,
  EstadoSorteo,
  ModalidadEntregaPremio,
} from '@prisma/client';

export class CreateSorteoDto {
  @ApiProperty({ example: 'Sorteo aniversario TikTok' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  titulo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ enum: CanalSorteo })
  @IsOptional()
  @IsEnum(CanalSorteo)
  canal?: CanalSorteo;

  @ApiPropertyOptional({ description: 'Fecha del sorteo (default: ahora)' })
  @IsOptional()
  @IsDateString()
  fechaSorteo?: string;

  @ApiPropertyOptional({
    description: 'Sede que organiza/despacha (el stock sale de aquí)',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Precio de la participación (S/) — default por ganador',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioParticipacion?: number;
}

export class UpdateSorteoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ enum: CanalSorteo })
  @IsOptional()
  @IsEnum(CanalSorteo)
  canal?: CanalSorteo;

  @ApiPropertyOptional({ enum: EstadoSorteo })
  @IsOptional()
  @IsEnum(EstadoSorteo)
  estado?: EstadoSorteo;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fechaSorteo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioParticipacion?: number;
}

export class RegistrarPremioDto {
  @ApiPropertyOptional({
    description:
      'Usuario ganador (cuenta del app). Si no viene, se resuelve por ' +
      'ganadorDni (Persona.dni es único y el registro de cliente crea ' +
      'la cuenta automáticamente).',
  })
  @IsOptional()
  @IsString()
  ganadorUsuarioId?: string;

  @ApiPropertyOptional({
    description: 'DNI del ganador — requerido si no viene ganadorUsuarioId',
  })
  @IsOptional()
  @IsString()
  ganadorDni?: string;

  @ApiProperty({ description: 'Snapshot del nombre con que se registró' })
  @IsString()
  @IsNotEmpty()
  ganadorNombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ganadorCelular?: string;

  @ApiProperty({ example: 'Laptop Lenovo IdeaPad 3 15.6"' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({
    description:
      'Solo si el premio descuenta stock (premios valiosos). Sin esto el ' +
      'premio es texto libre sin control de inventario.',
  })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad?: number;

  @ApiPropertyOptional({
    description:
      'Lo que este ganador pagó por participar (default: el precio de ' +
      'participación del sorteo). Editable — el último puede pagar menos.',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  montoParticipacion?: number;

  @ApiPropertyOptional({ enum: ModalidadEntregaPremio })
  @IsOptional()
  @IsEnum(ModalidadEntregaPremio)
  modalidad?: ModalidadEntregaPremio;

  @ApiPropertyOptional({ example: 'Shalom' })
  @IsOptional()
  @IsString()
  agenciaNombre?: string;

  @ApiPropertyOptional({ example: 'San Martín' })
  @IsOptional()
  @IsString()
  destinoDepartamento?: string;

  @ApiPropertyOptional({ example: 'Tarapoto' })
  @IsOptional()
  @IsString()
  destinoProvincia?: string;

  @ApiPropertyOptional({ example: 'Jr. Los Pinos 123' })
  @IsOptional()
  @IsString()
  agenciaDireccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    description:
      'Sede de la que sale el stock (default: la sede del sorteo). ' +
      'Obligatoria si el premio descuenta stock y el sorteo no tiene sede.',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;
}

/** El GANADOR indica su agencia de recojo (lo ÚNICO que puede editar). */
export class ElegirAgenciaPremioDto {
  @ApiProperty({ example: 'SHALOM' })
  @IsString()
  @IsNotEmpty()
  agenciaNombre: string;

  @ApiPropertyOptional({ example: 'San Martín' })
  @IsOptional()
  @IsString()
  destinoDepartamento?: string;

  @ApiPropertyOptional({ example: 'Tarapoto' })
  @IsOptional()
  @IsString()
  destinoProvincia?: string;

  @ApiPropertyOptional({ example: 'Jr. Los Pinos 123' })
  @IsOptional()
  @IsString()
  agenciaDireccion?: string;
}

/**
 * La EMPRESA corrige la entrega de un premio ya registrado (modalidad
 * y/o datos de agencia) — p.ej. quedó en RETIRO_TIENDA por error. Solo
 * antes del despacho.
 */
export class EditarEntregaPremioDto {
  @ApiProperty({ enum: ModalidadEntregaPremio })
  @IsEnum(ModalidadEntregaPremio)
  modalidad: ModalidadEntregaPremio;

  @ApiPropertyOptional({ example: 'SHALOM' })
  @IsOptional()
  @IsString()
  agenciaNombre?: string;

  @ApiPropertyOptional({ example: 'San Martín' })
  @IsOptional()
  @IsString()
  destinoDepartamento?: string;

  @ApiPropertyOptional({ example: 'Tarapoto' })
  @IsOptional()
  @IsString()
  destinoProvincia?: string;

  @ApiPropertyOptional({ example: 'Jr. Los Pinos 123' })
  @IsOptional()
  @IsString()
  agenciaDireccion?: string;
}

export class CambiarEstadoPremioDto {
  @ApiProperty({ enum: EstadoPremioSorteo })
  @IsEnum(EstadoPremioSorteo)
  estado: EstadoPremioSorteo;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  // Datos del despacho de agencia (típicamente al marcar ENVIADO;
  // re-enviar el mismo estado permite corregirlos).
  @ApiPropertyOptional({ example: '0012345' })
  @IsOptional()
  @IsString()
  envioNumeroOrden?: string;

  @ApiPropertyOptional({ example: 'SHA-88421' })
  @IsOptional()
  @IsString()
  envioCodigo?: string;

  @ApiPropertyOptional({
    description: 'Clave de recojo — el ganador la muestra en la agencia',
    example: '4471',
  })
  @IsOptional()
  @IsString()
  envioClave?: string;
}
