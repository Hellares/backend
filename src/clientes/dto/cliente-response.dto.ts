import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/utils/pagination.util';

export class ClienteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  personaId: string;

  @ApiPropertyOptional()
  usuarioId?: string;

  @ApiProperty()
  dni: string;

  @ApiProperty()
  nombres: string;

  @ApiProperty()
  apellidos: string;

  @ApiProperty()
  nombreCompleto: string;

  @ApiProperty()
  telefono: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  direccion?: string;

  @ApiPropertyOptional()
  distrito?: string;

  @ApiPropertyOptional()
  provincia?: string;

  @ApiPropertyOptional()
  departamento?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  estado: string; // EstadoCliente

  @ApiPropertyOptional()
  emailVerificado?: boolean;

  @ApiPropertyOptional()
  telefonoVerificado?: boolean;

  @ApiPropertyOptional()
  dniVerificado?: boolean;

  @ApiProperty()
  yaExistiaEnSistema: boolean;

  @ApiPropertyOptional()
  registradoPor?: string;

  @ApiPropertyOptional()
  registradoPorNombre?: string;

  @ApiProperty()
  fechaRegistro: Date;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;
}

export class PaginatedClienteResponseDto {
  @ApiProperty({ type: [ClienteResponseDto] })
  data: ClienteResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

export class RegistroClienteResponseDto {
  @ApiProperty()
  cliente: ClienteResponseDto;

  @ApiProperty({
    description: 'Indica si el cliente ya existía en el sistema',
  })
  yaExistia: boolean;

  @ApiProperty({
    description: 'Indica si el cliente ya estaba asociado a esta empresa',
  })
  yaEraClienteEmpresa: boolean;

  @ApiProperty({
    description: 'Mensaje descriptivo del resultado',
  })
  mensaje: string;
}
