import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProveedorDto } from './create-proveedor.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateProveedorDto extends PartialType(
  OmitType(CreateProveedorDto, ['empresaId', 'creadoPor'] as const),
) {
  @IsOptional()
  @IsString()
  actualizadoPor?: string;
}
