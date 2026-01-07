import { IsOptional, IsString, IsBoolean, IsInt, Min, Max, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateConfigProductosDto {
  @ApiPropertyOptional({
    description: 'Prefijo para códigos de productos (ej: "PROD", "PRD", "ART")',
    example: 'PROD',
    minLength: 1,
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  @Matches(/^[A-Z0-9]+$/, {
    message: 'El código solo puede contener letras mayúsculas y números',
  })
  productoCodigo?: string;

  @ApiPropertyOptional({
    description: 'Separador entre prefijo y número (ej: "-", "_", "")',
    example: '-',
    maxLength: 5,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  productoSeparador?: string;

  @ApiPropertyOptional({
    description: 'Longitud del número (cantidad de dígitos con padding)',
    example: 6,
    minimum: 4,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(10)
  productoLongitud?: number;

  @ApiPropertyOptional({
    description: 'Si debe incluir el código de sede en el formato',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  productoIncluirSede?: boolean;
}
