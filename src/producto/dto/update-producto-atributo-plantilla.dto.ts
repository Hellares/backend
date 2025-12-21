import { PartialType } from '@nestjs/swagger';
import { CreateProductoAtributoPlantillaDto } from './create-producto-atributo-plantilla.dto';

export class UpdateProductoAtributoPlantillaDto extends PartialType(
  CreateProductoAtributoPlantillaDto,
) {}
