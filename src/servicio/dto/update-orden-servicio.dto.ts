import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateOrdenServicioDto } from './create-orden-servicio.dto';

export class UpdateOrdenServicioDto extends PartialType(
  OmitType(CreateOrdenServicioDto, ['empresaId', 'clienteId'] as const),
) {}
