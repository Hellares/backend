import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProductoDto } from './create-producto.dto';

export class UpdateProductoDto extends PartialType(
  OmitType(CreateProductoDto, ['empresaId'] as const),
) {
  // Todos los campos son opcionales excepto empresaId que se omite
  // empresaId no se puede cambiar después de crear el producto
}
