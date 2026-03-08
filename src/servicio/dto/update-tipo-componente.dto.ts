import { PartialType } from '@nestjs/swagger';
import { CreateTipoComponenteDto } from './create-tipo-componente.dto';

export class UpdateTipoComponenteDto extends PartialType(CreateTipoComponenteDto) {}
