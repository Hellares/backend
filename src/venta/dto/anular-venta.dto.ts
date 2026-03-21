import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AnularVentaDto {
  @ApiProperty({ description: 'ID del usuario que autorizo la anulacion' })
  @IsString()
  @IsNotEmpty()
  autorizadoPorId: string;

  @ApiProperty({ description: 'Motivo de la anulacion' })
  @IsString()
  @IsNotEmpty()
  motivo: string;
}
