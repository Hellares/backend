import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { AccionIncidenciaProducto } from '@prisma/client';

export class ResolverItemDto {
  @IsEnum(AccionIncidenciaProducto)
  accionTomada: AccionIncidenciaProducto;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  sedeDestinoId?: string; // Para DEVOLVER_SEDE_PRINCIPAL
}
