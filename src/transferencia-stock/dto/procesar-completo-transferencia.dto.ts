import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProcesarCompletoTransferenciaDto {
  @ApiPropertyOptional({
    description: 'Ubicación del producto en la sede destino',
    example: 'Estante A2',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales',
    example: 'Productos recibidos en perfectas condiciones',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
