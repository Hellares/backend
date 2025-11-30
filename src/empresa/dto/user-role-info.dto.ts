import { ApiProperty } from '@nestjs/swagger';
import { Rol, EstadoCliente } from '@prisma/client';

/**
 * DTO para la información de rol del usuario en la empresa
 */
export class UserRoleInfoDto {
  @ApiProperty({
    description: 'ID de la relación usuario-empresa-rol',
    example: 'clxxx123456789',
  })
  id: string;

  @ApiProperty({
    description: 'Rol del usuario en la empresa',
    enum: Rol,
    example: Rol.EMPRESA_ADMIN,
  })
  rol: Rol;

  @ApiProperty({
    description: 'Indica si el rol está activo',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Estado del cliente/usuario en la empresa',
    enum: EstadoCliente,
    example: EstadoCliente.ACTIVO,
  })
  estado: EstadoCliente;

  @ApiProperty({
    description: 'Fecha de aprobación del rol',
    example: '2024-01-15T10:30:00.000Z',
    required: false,
  })
  fechaAprobacion?: Date;
}
