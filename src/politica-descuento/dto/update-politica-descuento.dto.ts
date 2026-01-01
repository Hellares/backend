import { PartialType } from '@nestjs/swagger';
import { CreatePoliticaDescuentoDto } from './create-politica-descuento.dto';

export class UpdatePoliticaDescuentoDto extends PartialType(
  CreatePoliticaDescuentoDto,
) {}
