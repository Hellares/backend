import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/utils/pagination.util';
import { Rol } from '@prisma/client';

export class UsuarioResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  emailVerificado: boolean;

  @ApiProperty()
  telefonoVerificado: boolean;

  @ApiPropertyOptional({ enum: Rol })
  rolGlobal?: Rol;

  @ApiPropertyOptional()
  lastLoginAt?: Date;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;

  // Información de persona
  @ApiPropertyOptional()
  persona?: {
    id: string;
    nombres: string;
    apellidos: string;
    dni?: string;
  };

  // Empresas del usuario
  @ApiPropertyOptional({
    type: [Object],
    description: 'Empresas y roles del usuario',
  })
  empresas?: Array<{
    id: string;
    empresaId: string;
    empresaNombre: string;
    rol: Rol;
    isActive: boolean;
    estado: string;
  }>;
}

export class PaginatedUsuarioResponseDto {
  @ApiProperty({ type: [UsuarioResponseDto] })
  data: UsuarioResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}
