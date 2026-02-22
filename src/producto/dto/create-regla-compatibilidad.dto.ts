import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsObject,
  ValidateIf,
} from 'class-validator';
import { TipoValidacionCompatibilidad } from '@prisma/client';

export class CreateReglaCompatibilidadDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  atributoOrigenClave: string;

  @IsString()
  @IsNotEmpty()
  categoriaOrigenId: string;

  @IsString()
  @IsNotEmpty()
  atributoDestinoClave: string;

  @IsString()
  @IsNotEmpty()
  categoriaDestinoId: string;

  @IsEnum(TipoValidacionCompatibilidad)
  @IsOptional()
  tipoValidacion?: TipoValidacionCompatibilidad;

  @IsObject()
  @IsOptional()
  @ValidateIf((o) => o.tipoValidacion === TipoValidacionCompatibilidad.INCLUYE_EN)
  mapeoValores?: Record<string, string[]>;
}
