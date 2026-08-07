import { IsString, IsNotEmpty, IsNumber, IsOptional, IsObject, IsBoolean, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class VarianteAtributoDto {
  @IsString()
  @IsNotEmpty()
  atributoId: string; // ID del ProductoAtributo

  @IsString()
  @IsNotEmpty()
  valor: string; // Valor del atributo
}

export class CreateProductoVarianteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string; // "Negro - USB", "Blanco - Bluetooth"

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsOptional()
  unidadMedidaId?: string | null; // ID de la unidad de medida (EmpresaUnidadMedida)

  @IsString()
  @IsOptional()
  codigoBarras?: string;

  // ✅ Atributos estructurados (recomendado)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VarianteAtributoDto)
  @IsOptional()
  atributosEstructurados?: VarianteAtributoDto[];

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  peso?: number;

  @IsObject()
  @IsOptional()
  dimensiones?: Record<string, number>; // {"largo": 30, "ancho": 20, "alto": 5}

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number;

  @IsString({ each: true })
  @IsOptional()
  imagenesIds?: string[]; // IDs de archivos para la variante
}
