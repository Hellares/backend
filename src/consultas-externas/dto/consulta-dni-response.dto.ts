import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsultaDniResponseDto {
  @ApiProperty({ example: '27427864' })
  dni: string;

  @ApiProperty({ example: 'JOSE PEDRO' })
  nombres: string;

  @ApiProperty({ example: 'CASTILLO' })
  apellidoPaterno: string;

  @ApiProperty({ example: 'TERRONES' })
  apellidoMaterno: string;

  @ApiProperty({ example: 'CASTILLO TERRONES, JOSE PEDRO' })
  nombreCompleto: string;

  @ApiProperty({ example: 'CAJAMARCA' })
  departamento: string;

  @ApiProperty({ example: 'CHOTA' })
  provincia: string;

  @ApiProperty({ example: 'TACABAMBA' })
  distrito: string;

  @ApiProperty({ example: 'CASERIO PUÑA' })
  direccion: string;

  @ApiProperty({ example: 'CASERIO PUÑA, CAJAMARCA - CHOTA - TACABAMBA' })
  direccionCompleta: string;

  @ApiProperty({ example: '060417' })
  ubigeo: string;

  @ApiPropertyOptional({ example: '987654321' })
  telefono?: string;

  @ApiPropertyOptional({ example: 'juan@example.com' })
  email?: string;

  @ApiPropertyOptional({
    example: 'INTERNO',
    enum: ['INTERNO', 'RENIEC', 'MIGRACIONES'],
  })
  origen?: 'INTERNO' | 'RENIEC' | 'MIGRACIONES';

  @ApiPropertyOptional({ example: true })
  existeEnSistema?: boolean;

  @ApiPropertyOptional()
  personaId?: string;

  @ApiPropertyOptional({ description: 'Indica si la persona ya tiene un usuario vinculado' })
  tieneUsuario?: boolean;
}
