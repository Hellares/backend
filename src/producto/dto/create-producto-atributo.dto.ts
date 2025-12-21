import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AtributoTipo } from '@prisma/client';

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

  @IsString()
  @IsOptional()
  categoriaId?: string; // Asociar atributo a una categoría específica

  @IsArray()
  @IsString({ each: true })
  @ValidateIf((o) => o.tipo === AtributoTipo.SELECT || o.tipo === AtributoTipo.MULTI_SELECT)
  @IsNotEmpty({ each: true })
  @IsOptional()
  valores?: string[]; // ["Negro", "Blanco", "Rojo"]

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
