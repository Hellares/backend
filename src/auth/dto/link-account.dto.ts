import { IsString, IsNotEmpty, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkAccountDto {
  @ApiProperty({
    description: 'DNI de la cuenta existente a vincular',
    example: '44885296',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{8}$/, { message: 'El DNI debe tener 8 dígitos' })
  dni: string;

  @ApiProperty({
    description: 'ID de la Persona de la cuenta existente (obtenido de consultarDni)',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  targetPersonaId: string;

  @ApiProperty({
    description:
      'Contraseña actual de la cuenta destino. Requerida para probar ' +
      'que el usuario es dueño de esa cuenta antes de vincular.',
    example: 'MiPassword123',
  })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña de la cuenta destino es requerida' })
  @MinLength(6)
  targetPassword: string;
}
