import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/utils/pagination.util';
import { Rol, SedeRole } from '@prisma/client';

export class UsuarioResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  personaId: string;

  @ApiProperty()
  dni: string;

  @ApiProperty()
  nombres: string;

  @ApiProperty()
  apellidos: string;

  @ApiProperty()
  nombreCompleto: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional({ description: 'Nombre corto mostrado en tickets' })
  aliasTicket?: string;

  @ApiPropertyOptional()
  direccion?: string;

  @ApiPropertyOptional()
  distrito?: string;

  @ApiPropertyOptional()
  provincia?: string;

  @ApiPropertyOptional()
  departamento?: string;

  @ApiProperty({ enum: Rol })
  rolEnEmpresa: Rol;

  @ApiPropertyOptional({ enum: Rol })
  rolGlobal?: Rol;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  emailVerificado: boolean;

  @ApiProperty()
  telefonoVerificado: boolean;

  @ApiProperty()
  dniVerificado: boolean;

  @ApiProperty()
  requiereCambioPassword: boolean;

  @ApiPropertyOptional()
  lastLoginAt?: Date;

  @ApiProperty()
  estado: string;

  @ApiPropertyOptional()
  registradoPor?: string;

  @ApiPropertyOptional()
  registradoPorNombre?: string;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;

  // Sedes asignadas
  @ApiPropertyOptional({
    type: [Object],
    description: 'Sedes donde trabaja el usuario',
  })
  sedes?: Array<{
    id: string;
    sedeId: string;
    sedeNombre: string;
    rol: SedeRole;
    puedeAbrirCaja: boolean;
    puedeCerrarCaja: boolean;
    limiteCreditoVenta?: number;
    permisos: string[];
    accesosRapidosOcultos: string[];
    isActive: boolean;
  }>;
}

export class RegistroUsuarioResponseDto {
  @ApiProperty({ type: UsuarioResponseDto })
  usuario: UsuarioResponseDto;

  @ApiProperty()
  yaExistia: boolean;

  @ApiProperty()
  yaEraEmpleadoEmpresa: boolean;

  @ApiProperty()
  mensaje: string;
}

export class PaginatedUsuarioResponseDto {
  @ApiProperty({ type: [UsuarioResponseDto] })
  data: UsuarioResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}
