import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateAdelantoDto {
  @ApiProperty({
    description: 'ID del empleado que solicita el adelanto',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsNotEmpty({ message: 'El ID del empleado es requerido' })
  @IsString()
  empleadoId: string;

  @ApiProperty({
    description: 'Monto del adelanto',
    example: 500,
    minimum: 1,
  })
  @IsNotEmpty({ message: 'El monto es requerido' })
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(1, { message: 'El monto debe ser al menos 1' })
  monto: number;

  @ApiPropertyOptional({
    description: 'Motivo del adelanto',
    example: 'Emergencia médica',
  })
  @IsOptional()
  @IsString()
  motivo?: string;
}
