import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AtributoTipo } from '@prisma/client';
import { OpcionAtributoDto } from './create-producto-atributo.dto';

export class UpdateProductoAtributoDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  clave?: string;

  @IsEnum(AtributoTipo)
  @IsOptional()
  tipo?: AtributoTipo;

  @IsBoolean()
  @IsOptional()
  requerido?: boolean;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  unidad?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categoriaIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @ValidateIf((o) => o.tipo === AtributoTipo.SELECT || o.tipo === AtributoTipo.MULTI_SELECT)
  @IsNotEmpty({ each: true })
  @IsOptional()
  valores?: string[];

  /** Ver `CreateProductoAtributoDto.opciones`: si viene, manda sobre `valores`. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpcionAtributoDto)
  @IsOptional()
  opciones?: OpcionAtributoDto[];

  /** `null` explícito desarma la dependencia y deja el atributo como raíz. */
  @IsString()
  @IsOptional()
  dependeDeAtributoId?: string | null;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number;

  @IsBoolean()
  @IsOptional()
  mostrarEnListado?: boolean;

  @IsBoolean()
  @IsOptional()
  usarParaFiltros?: boolean;

  @IsBoolean()
  @IsOptional()
  mostrarEnMarketplace?: boolean;
}
