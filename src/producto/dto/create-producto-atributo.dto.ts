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

/**
 * Una opción elegible del atributo.
 *
 * `id` viaja de vuelta al editar y es lo que permite RENOMBRAR sin romper la
 * cadena: con id, la opción se actualiza en su lugar y sus hijas la siguen
 * apuntando; sin id se la trata como nueva, y la vieja —con todas sus hijas—
 * se borra.
 */
export class OpcionAtributoDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  valor: string;

  /** De qué valor del atributo PADRE cuelga. Obligatorio si el atributo declara `dependeDeAtributoId`. */
  @IsString()
  @IsOptional()
  padreValor?: string;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number;
}

export class CreateProductoAtributoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string; // "Color", "Socket del Procesador", "Tipo de RAM"

  @IsString()
  @IsNotEmpty()
  clave: string; // "color", "cpu_socket", "ram_type" - identificador programático único

  @IsEnum(AtributoTipo)
  tipo: AtributoTipo;

  @IsBoolean()
  @IsOptional()
  requerido?: boolean;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  unidad?: string; // "MHz", "GB", "mm", "W" - para valores numéricos

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categoriaIds?: string[]; // Asociar atributo a múltiples categorías (vacío = global)

  /**
   * Lista PLANA de opciones. Sigue siendo el camino normal para una selección
   * común; una dependiente necesita `opciones`, que es la única forma de decir
   * de qué padre cuelga cada una.
   */
  @IsArray()
  @IsString({ each: true })
  @ValidateIf((o) => o.tipo === AtributoTipo.SELECT || o.tipo === AtributoTipo.MULTI_SELECT)
  @IsNotEmpty({ each: true })
  @IsOptional()
  valores?: string[]; // ["Negro", "Blanco", "Rojo"]

  /** Opciones con su jerarquía. Si viene, MANDA sobre `valores`, que se regenera a partir de acá. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpcionAtributoDto)
  @IsOptional()
  opciones?: OpcionAtributoDto[];

  /** Atributo del que dependen las opciones de este. Solo con `tipo = SELECT_DEPENDIENTE`. */
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
