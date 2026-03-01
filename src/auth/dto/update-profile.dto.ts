import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'DNI peruano (8 dígitos)', example: '12345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'El DNI debe tener exactamente 8 dígitos numéricos' })
  dni?: string;

  @ApiPropertyOptional({ description: 'Teléfono peruano (9 dígitos, empieza con 9)', example: '987654321' })
  @IsOptional()
  @IsString()
  @Matches(/^9\d{8}$/, { message: 'El teléfono debe tener 9 dígitos y empezar con 9' })
  telefono?: string;

  @ApiPropertyOptional({ description: 'Dirección del usuario', example: 'Av. Javier Prado 123, San Isidro' })
  @IsOptional()
  @IsString()
  @Length(3, 255, { message: 'La dirección debe tener entre 3 y 255 caracteres' })
  direccion?: string;
}
