import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CambiarPlanDto {
  @ApiProperty({
    description: 'ID del plan de suscripción al que se desea cambiar',
    example: 'clx1234567890abcdefghij'
  })
  @IsString()
  @IsNotEmpty({ message: 'El ID del plan es requerido' })
  planId: string;
}