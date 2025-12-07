import { IsString, IsNotEmpty, IsNumber, IsOptional, IsObject, IsBoolean, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductoVarianteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string; // "Negro - USB", "Blanco - Bluetooth"

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsOptional()
  codigoBarras?: string;

  @IsObject()
  @IsNotEmpty()
  atributos: Record<string, any>; // {"color": "Negro", "conexion": "USB"}

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  precio: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  precioCosto?: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  precioOferta?: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  stockMinimo?: number;

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
