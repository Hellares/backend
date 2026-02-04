import { IsString, IsNumber, IsOptional, IsBoolean, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para actualizar un componente de combo
 */
export class UpdateComponenteComboDto {
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  cantidad?: number;

  // Precio del componente dentro del combo. Enviar null para eliminar el override y usar precio regular.
  @ValidateIf((o) => o.precioEnCombo !== null)
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  precioEnCombo?: number | null;

  @IsBoolean()
  @IsOptional()
  esPersonalizable?: boolean;

  @IsString()
  @IsOptional()
  categoriaComponente?: string;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number;
}
