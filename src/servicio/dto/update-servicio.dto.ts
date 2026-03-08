import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateServicioDto } from './create-servicio.dto';

export class UpdateServicioDto extends PartialType(
  OmitType(CreateServicioDto, ['empresaId'] as const),
) {}
