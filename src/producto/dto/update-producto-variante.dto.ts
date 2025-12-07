import { PartialType } from '@nestjs/mapped-types';
import { CreateProductoVarianteDto } from './create-producto-variante.dto';

export class UpdateProductoVarianteDto extends PartialType(CreateProductoVarianteDto) {}
