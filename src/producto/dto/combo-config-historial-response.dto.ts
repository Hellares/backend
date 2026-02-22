import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de respuesta para el historial de configuración de combos
 */
export class ComboConfigHistorialResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  comboId: string;

  @ApiProperty()
  tipoCambio: string;

  @ApiPropertyOptional()
  valorAnterior?: Record<string, any> | null;

  @ApiProperty()
  valorNuevo: Record<string, any>;

  @ApiPropertyOptional()
  razon?: string | null;

  @ApiPropertyOptional()
  sedeId?: string | null;

  @ApiProperty()
  usuarioId: string;

  @ApiProperty()
  creadoEn: Date;

  @ApiPropertyOptional()
  usuario?: {
    id: string;
    email?: string;
    persona?: {
      nombres: string;
      apellidos: string;
    };
  };
}
