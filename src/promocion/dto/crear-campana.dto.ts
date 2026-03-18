import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  MinLength,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';

export class CrearCampanaDto {
  @ApiProperty({
    description: 'Título de la notificación',
    example: '¡Ofertas de temporada!',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  titulo: string;

  @ApiProperty({
    description: 'Mensaje/cuerpo de la notificación',
    example: 'Aprovecha hasta 50% de descuento en productos seleccionados',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  mensaje: string;

  @ApiPropertyOptional({
    description: 'IDs de productos en oferta a incluir en la campaña',
    example: ['clxyz123', 'clxyz456'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  productosIds?: string[];
}
