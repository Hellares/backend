import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisenoASepararDto {
  @ApiProperty({ description: 'Foto de la variante que identifica el diseño' })
  @IsString()
  @IsNotEmpty()
  archivoId: string;

  @ApiProperty({ description: 'Unidades de ESE diseño', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  cantidad: number;
}

/**
 * Separar una variante por diseño: cada foto pasa a ser una variante con las
 * unidades que se le asignan. Lo que no se asigna se queda en la original.
 */
export class SepararPorDisenoDto {
  @ApiProperty({ description: 'Sede de la que salen las unidades' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ type: [DisenoASepararDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DisenoASepararDto)
  disenos: DisenoASepararDto[];
}
