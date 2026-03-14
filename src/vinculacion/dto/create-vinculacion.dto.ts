import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateVinculacionDto {
  @ApiPropertyOptional({ description: 'ID del ClienteEmpresa a vincular (si ya existe)' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'RUC de la empresa a vincular (si no tiene clienteEmpresaId)' })
  @IsOptional()
  @IsString()
  ruc?: string;

  @ApiPropertyOptional({ description: 'Mensaje para la empresa vinculada' })
  @IsOptional()
  @IsString()
  mensaje?: string;

  // Set by controller from header
  empresaSolicitanteId?: string;
}
