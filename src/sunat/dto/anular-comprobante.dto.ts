import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnularComprobanteDto {
  @ApiProperty({ description: 'Motivo de la anulación', example: 'Error en datos del cliente' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(250)
  motivo: string;
}
