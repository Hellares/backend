import { IsArray } from 'class-validator';

export class GuardarImpresorasDto {
  @IsArray()
  config: any[];
}
