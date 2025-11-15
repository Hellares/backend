import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CambiarPlanDto {
  @ApiProperty({
    description: 'ID del plan de suscripción al que se desea cambiar',
    example: 'plan-id-uuid-example'
  })
  @IsString()
  @IsNotEmpty({ message: 'El ID del plan es requerido' })
  @IsUUID('4', { message: 'El ID del plan debe ser un UUID válido' })
  planId: string;
}