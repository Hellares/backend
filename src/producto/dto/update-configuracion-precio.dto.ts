import { PartialType } from '@nestjs/mapped-types';
import { CreateConfiguracionPrecioDto } from './create-configuracion-precio.dto';

export class UpdateConfiguracionPrecioDto extends PartialType(
  CreateConfiguracionPrecioDto,
) {}
