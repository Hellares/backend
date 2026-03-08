import { PartialType } from '@nestjs/swagger';
import { CreateModeloEquipoDto } from './create-modelo-equipo.dto';

export class UpdateModeloEquipoDto extends PartialType(CreateModeloEquipoDto) {}
