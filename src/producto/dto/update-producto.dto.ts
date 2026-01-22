import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProductoDto } from './create-producto.dto';

export class UpdateProductoDto extends PartialType(
  OmitType(CreateProductoDto, ['empresaId', 'sedesIds'] as const),
) {
  // Todos los campos son opcionales excepto empresaId y sedesIds que se omiten
  // empresaId y sedesIds no se pueden cambiar después de crear el producto
  // Un producto ya creado pertenece a una sede específica
}
