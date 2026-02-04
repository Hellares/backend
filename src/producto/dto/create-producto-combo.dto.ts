import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, Min, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPrecioCombo } from '@prisma/client';

/**
 * DTO para crear un producto combo
 * Incluye información del combo y sus componentes
 */
export class CreateProductoComboDto {
  @IsEnum(TipoPrecioCombo)
  @IsNotEmpty()
  tipoPrecioCombo: TipoPrecioCombo; // FIJO, CALCULADO, CALCULADO_CON_DESCUENTO

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  descuentoPorcentaje?: number; // Solo para CALCULADO_CON_DESCUENTO

  @IsNotEmpty()
  componentes: CreateComponenteComboDto[];
}

/**
 * DTO para agregar un componente a un combo
 */
export class CreateComponenteComboDto {
  @IsString()
  @IsOptional()
  componenteProductoId?: string; // ID del producto (si no es variante)

  @IsString()
  @IsOptional()
  componenteVarianteId?: string; // ID de la variante (si es variante específica)

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  cantidad: number; // Cantidad de este componente en el combo

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  precioEnCombo?: number; // Precio del componente dentro del combo (override). Si es null, se usa el precio regular.

  @IsBoolean()
  @IsOptional()
  esPersonalizable?: boolean; // Si puede ser reemplazado por otra opción

  @IsString()
  @IsOptional()
  categoriaComponente?: string; // "CPU", "RAM", "Almacenamiento", etc.

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number; // Orden de visualización
}

/**
 * DTO para agregar múltiples componentes a un combo en batch
 */
export class CreateComponentesComboBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateComponenteComboDto)
  @IsNotEmpty()
  componentes: CreateComponenteComboDto[];
}
