import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecibirTransferenciaDto {
  @ApiProperty({
    description: 'Cantidad recibida (puede ser menor si hubo merma)',
    example: 48,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  cantidadRecibida: number;

  @ApiPropertyOptional({
    description: 'Ubicación física donde se almacenará en la sede destino',
    example: 'Almacén B, Pasillo 2, Estante C',
  })
  @IsOptional()
  @IsString()
  ubicacion?: string;

  @ApiPropertyOptional({
    description: 'Observaciones al recibir',
    example: 'Recibido - 2 unidades con empaque dañado',
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
