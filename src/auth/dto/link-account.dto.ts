import { IsString, IsNotEmpty, Matches } from 'class-validator';
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
}
