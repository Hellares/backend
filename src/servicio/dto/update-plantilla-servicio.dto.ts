import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePlantillaServicioDto } from './create-plantilla-servicio.dto';

export class UpdatePlantillaServicioDto extends PartialType(
  OmitType(CreatePlantillaServicioDto, ['campos'] as const),
) {}
