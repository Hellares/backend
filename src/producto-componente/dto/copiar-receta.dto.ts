import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CopiarRecetaDto {
  @ApiProperty({
    description:
      'ID de la variante destino a la que se copiará la receta base (varianteId null) del producto.',
    example: 'cmoxyz...',
  })
  @IsString()
  @IsNotEmpty()
  varianteId!: string;

  @ApiProperty({
    description:
      'Si true, reemplaza la receta actual de la variante. Si false (default), falla si la variante ya tiene receta.',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  sobrescribir?: boolean;
}
