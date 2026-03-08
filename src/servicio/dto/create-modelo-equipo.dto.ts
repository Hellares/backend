import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateModeloEquipoDto {
  @ApiProperty({ description: 'ID del tipo de componente' })
  @IsString()
  @IsNotEmpty()
  tipoComponenteId: string;

  @ApiProperty({ description: 'Marca del equipo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  marca: string;

  @ApiProperty({ description: 'Modelo del equipo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  modelo: string;

  @ApiPropertyOptional({ description: 'Especificaciones (JSON)' })
  @IsOptional()
  especificaciones?: any;
}
