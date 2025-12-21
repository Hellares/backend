import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

/**
 * DTO para aplicar una plantilla a un producto o variante
 */
export class AplicarPlantillaDto {
  @ApiProperty({
    description: 'ID de la plantilla a aplicar',
  })
  @IsString()
  plantillaId: string;

  @ApiPropertyOptional({
    description: 'ID del producto al que se aplicará (solo para productos sin variantes)',
  })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({
    description: 'ID de la variante a la que se aplicará',
  })
  @IsOptional()
  @IsString()
  varianteId?: string;
}
