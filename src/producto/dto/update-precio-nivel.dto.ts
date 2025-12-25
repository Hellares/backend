import { PartialType } from '@nestjs/swagger';
import { CreatePrecioNivelDto } from './create-precio-nivel.dto';

export class UpdatePrecioNivelDto extends PartialType(CreatePrecioNivelDto) {}
