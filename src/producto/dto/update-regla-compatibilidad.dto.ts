import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsObject,
  IsBoolean,
  ValidateIf,
} from 'class-validator';
import { TipoValidacionCompatibilidad } from '@prisma/client';

export class UpdateReglaCompatibilidadDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  atributoOrigenClave?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  categoriaOrigenId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  atributoDestinoClave?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  categoriaDestinoId?: string;

  @IsEnum(TipoValidacionCompatibilidad)
  @IsOptional()
  tipoValidacion?: TipoValidacionCompatibilidad;

  @IsObject()
  @IsOptional()
  @ValidateIf((o) => o.tipoValidacion === TipoValidacionCompatibilidad.INCLUYE_EN)
  mapeoValores?: Record<string, string[]>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
