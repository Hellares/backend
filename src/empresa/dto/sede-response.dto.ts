import { ApiProperty } from '@nestjs/swagger';
import { Rol } from '@prisma/client';

/**
 * DTO para la información de una sede
 */
export class SedeResponseDto {
  @ApiProperty({
    description: 'ID de la sede',
    example: 'clxxx123456789',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre de la sede',
    example: 'Sede Principal',
  })
  nombre: string;

  @ApiProperty({
    description: 'Teléfono de la sede',
    example: '+51 999 888 777',
    required: false,
  })
  telefono?: string;

  @ApiProperty({
    description: 'Email de la sede',
    example: 'sede@empresa.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Dirección de la sede',
    example: 'Av. Principal 123, Lima',
    required: false,
  })
  direccion?: string;

  @ApiProperty({
    description: 'Indica si es la sede principal',
    example: true,
  })
  esPrincipal: boolean;

  @ApiProperty({
    description: 'Rol del usuario en esta sede (si tiene asignación específica)',
    enum: Rol,
    example: Rol.SEDE_ADMIN,
    required: false,
  })
  userRole?: Rol;

  @ApiProperty({
    description: 'Indica si la sede está activa',
    example: true,
  })
  isActive: boolean;
}
