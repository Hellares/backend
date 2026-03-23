import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RechazarIncidenciaDto {
  @ApiProperty({
    description: 'Motivo del rechazo de la incidencia',
    example: 'No hay cobertura suficiente para esas fechas',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo de rechazo es obligatorio' })
  motivoRechazo: string;
}
