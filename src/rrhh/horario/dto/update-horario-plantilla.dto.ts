import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateHorarioPlantillaDto, HorarioPlantillaDiaDto } from './create-horario-plantilla.dto';

export class UpdateHorarioPlantillaDto extends PartialType(
  OmitType(CreateHorarioPlantillaDto, ['dias'] as const),
) {
  @ApiPropertyOptional({
    description: 'Configuración de días de la semana (si se proporciona, reemplaza todos los días existentes)',
    type: [HorarioPlantillaDiaDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HorarioPlantillaDiaDto)
  dias?: HorarioPlantillaDiaDto[];

  @ApiPropertyOptional({
    description: 'Indica si la plantilla está activa',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
