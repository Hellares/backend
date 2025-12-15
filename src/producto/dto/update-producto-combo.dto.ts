import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';
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
