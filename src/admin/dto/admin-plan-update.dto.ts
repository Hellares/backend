import { IsOptional, IsString, IsNumber, IsBoolean, IsInt, Min, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminPlanUpdateDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioSemestral?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioAnual?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteProductos?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteServicios?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteUsuarios?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteSedes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitePlantillasAtributos?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteCotizaciones?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limiteAlmacenamientoMB?: number;

  @IsOptional()
  @IsBoolean()
  tieneWebPermanente?: boolean;

  @IsOptional()
  @IsBoolean()
  tienePersonalizacion?: boolean;

  @IsOptional()
  @IsBoolean()
  tieneDominioPropio?: boolean;

  @IsOptional()
  @IsBoolean()
  tieneApi?: boolean;

  @IsOptional()
  @IsBoolean()
  tieneReportesAvanzados?: boolean;

  @IsOptional()
  @IsObject()
  caracteristicas?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
