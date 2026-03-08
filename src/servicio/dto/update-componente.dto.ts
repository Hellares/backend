import { PartialType } from '@nestjs/swagger';
import { CreateComponenteDto } from './create-componente.dto';

export class UpdateComponenteDto extends PartialType(CreateComponenteDto) {}
