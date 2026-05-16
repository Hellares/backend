import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class AnularPagoGastoRecurrenteDto {
  @ApiProperty({
    example: 'Monto incorrecto, se registrará el correcto',
    description: 'Motivo de la anulación (auditable)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  motivo: string;
}
