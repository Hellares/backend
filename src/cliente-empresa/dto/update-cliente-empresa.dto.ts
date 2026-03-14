import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateClienteEmpresaDto } from './create-cliente-empresa.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateClienteEmpresaDto extends PartialType(
  OmitType(CreateClienteEmpresaDto, ['empresaId', 'creadoPor'] as const),
) {
  @IsOptional()
  @IsString()
  actualizadoPor?: string;
}
