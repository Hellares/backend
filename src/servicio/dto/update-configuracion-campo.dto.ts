import { PartialType } from '@nestjs/swagger';
import { CreateConfiguracionCampoDto } from './create-configuracion-campo.dto';

export class UpdateConfiguracionCampoDto extends PartialType(
  CreateConfiguracionCampoDto,
) {}
