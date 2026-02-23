import { ApiProperty } from '@nestjs/swagger';
import { EstadoSuscripcion } from '@prisma/client';
import { EmpresaPermissionsDto } from './empresa-permissions.dto';
import { EmpresaStatisticsDto } from './empresa-statistics.dto';
import { SedeResponseDto } from './sede-response.dto';
import { UserRoleInfoDto } from './user-role-info.dto';

/**
 * DTO para la información básica de la empresa
 */
export class EmpresaInfoDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'clxxx123456789',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre de la empresa',
    example: 'Mi Empresa SAC',
  })
  nombre: string;

  @ApiProperty({
    description: 'RUC de la empresa',
    example: '20123456789',
    required: false,
  })
  ruc?: string;

  @ApiProperty({
    description: 'Subdominio de la empresa',
    example: 'mi-empresa',
    required: false,
  })
  subdominio?: string;

  @ApiProperty({
    description: 'URL del logo de la empresa',
    example: 'https://example.com/logo.png',
    required: false,
  })
  logo?: string;

  @ApiProperty({
    description: 'Email de la empresa',
    example: 'contacto@miempresa.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Teléfono de la empresa',
    example: '+51 999 888 777',
    required: false,
  })
  telefono?: string;

  @ApiProperty({
    description: 'Descripción de la empresa',
    example: 'Empresa dedicada a...',
    required: false,
  })
  descripcion?: string;

  @ApiProperty({
    description: 'Sitio web de la empresa',
    example: 'https://miempresa.com',
    required: false,
  })
  web?: string;

  @ApiProperty({
    description: 'ID del plan de suscripción actual',
    example: 'clxxx987654321',
    required: false,
  })
  planSuscripcionId?: string;

  @ApiProperty({
    description: 'Estado de la suscripción',
    enum: EstadoSuscripcion,
    example: EstadoSuscripcion.ACTIVA,
  })
  estadoSuscripcion: EstadoSuscripcion;

  @ApiProperty({
    description: 'Número de usuarios actuales',
    example: 10,
  })
  usuariosActuales: number;

  @ApiProperty({
    description: 'Fecha de inicio de la suscripción',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
  })
  fechaInicioSuscripcion?: Date;

  @ApiProperty({
    description: 'Fecha de vencimiento de la suscripción',
    example: '2024-12-31T23:59:59.000Z',
    required: false,
  })
  fechaVencimiento?: Date;

  @ApiProperty({
    description: 'Información del plan de suscripción',
    required: false,
  })
  planSuscripcion?: {
    id: string;
    nombre: string;
    descripcion: string;
    precio: number;
    periodo: string;
  };
}

/**
 * DTO para el contexto completo de la empresa
 */
export class EmpresaContextResponseDto {
  @ApiProperty({
    description: 'Información de la empresa',
    type: EmpresaInfoDto,
  })
  empresa: EmpresaInfoDto;

  @ApiProperty({
    description: 'Roles del usuario en esta empresa',
    type: [UserRoleInfoDto],
  })
  userRoles: UserRoleInfoDto[];

  @ApiProperty({
    description: 'Lista de sedes de la empresa',
    type: [SedeResponseDto],
  })
  sedes: SedeResponseDto[];

  @ApiProperty({
    description: 'Permisos del usuario en la empresa',
    type: EmpresaPermissionsDto,
  })
  permissions: EmpresaPermissionsDto;

  @ApiProperty({
    description: 'Estadísticas de la empresa',
    type: EmpresaStatisticsDto,
  })
  statistics: EmpresaStatisticsDto;

  @ApiProperty({
    description: 'Información de límites y uso del plan de suscripción',
    required: false,
  })
  planLimits?: any;
}
