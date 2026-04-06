import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsultaLicenciaResponseDto {
  @ApiProperty({ example: '41410641' })
  numeroDocumento: string;

  @ApiProperty({ example: 'LUIS YTALO VICENTE ROMERO AVALOS' })
  nombreCompleto: string;

  @ApiProperty({ example: 'D41410641' })
  licenciaNumero: string;

  @ApiProperty({ example: 'A IIb' })
  licenciaCategoria: string;

  @ApiPropertyOptional({ example: '17/05/2026' })
  licenciaFechaVencimiento?: string;

  @ApiProperty({ example: 'VIGENTE' })
  licenciaEstado: string;

  @ApiPropertyOptional({ example: 'CON LENTES' })
  licenciaRestricciones?: string;
}
