import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateServicioComponenteDto } from './create-servicio-componente.dto';

// Permite editar los campos de la acción de un componente ya asociado a la
// orden (costos, resultado, observaciones, etc.). El componenteId no se edita
// (para cambiar de componente se quita y se agrega otro).
export class UpdateServicioComponenteDto extends PartialType(
  OmitType(CreateServicioComponenteDto, ['componenteId'] as const),
) {}
