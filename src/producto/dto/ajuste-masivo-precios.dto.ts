import { IsEnum, IsNotEmpty, IsNumber, IsArray, IsOptional, IsBoolean, IsString, Min, Max, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AlcanceAjuste {
  TODOS = 'TODOS',
  SELECCIONADOS = 'SELECCIONADOS',
}

export enum TipoAjuste {
  PORCENTAJE = 'PORCENTAJE',
}

export enum OperacionAjuste {
  INCREMENTO = 'INCREMENTO',
  DECREMENTO = 'DECREMENTO',
}

export enum TipoRedondeo {
  DOS_DECIMALES = 'DOS_DECIMALES',
}

export class AjusteMasivoPreciosDto {
  @ApiProperty({
    enum: AlcanceAjuste,
    description: 'Alcance del ajuste: TODOS los productos o solo SELECCIONADOS',
    example: AlcanceAjuste.TODOS,
  })
  @IsEnum(AlcanceAjuste)
  @IsNotEmpty()
  alcance: AlcanceAjuste;

  @ApiPropertyOptional({
    type: [String],
    description: 'IDs de productos seleccionados (requerido si alcance es SELECCIONADOS)',
    example: ['clxxx123', 'clxxx456'],
  })
  @ValidateIf((o) => o.alcance === AlcanceAjuste.SELECCIONADOS)
  @IsArray()
  @IsNotEmpty({ message: 'Debe seleccionar al menos un producto' })
  productosIds?: string[];

  @ApiProperty({
    enum: TipoAjuste,
    description: 'Tipo de ajuste: PORCENTAJE (Fase 1)',
    example: TipoAjuste.PORCENTAJE,
  })
  @IsEnum(TipoAjuste)
  @IsNotEmpty()
  tipoAjuste: TipoAjuste;

  @ApiProperty({
    type: Number,
    description: 'Valor del ajuste en porcentaje (1-100)',
    example: 5,
    minimum: 0.01,
    maximum: 100,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01, { message: 'El porcentaje debe ser mayor a 0' })
  @Max(100, { message: 'El porcentaje no puede ser mayor a 100%' })
  valor: number;

  @ApiProperty({
    enum: OperacionAjuste,
    description: 'Operación: INCREMENTO o DECREMENTO',
    example: OperacionAjuste.INCREMENTO,
  })
  @IsEnum(OperacionAjuste)
  @IsNotEmpty()
  operacion: OperacionAjuste;

  @ApiProperty({
    type: Boolean,
    description: 'Si true, también ajusta las variantes de los productos',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  incluirVariantes: boolean;

  @ApiProperty({
    enum: TipoRedondeo,
    description: 'Tipo de redondeo: DOS_DECIMALES (Fase 1)',
    example: TipoRedondeo.DOS_DECIMALES,
  })
  @IsEnum(TipoRedondeo)
  @IsNotEmpty()
  redondeo: TipoRedondeo;

  @ApiProperty({
    type: Boolean,
    description: 'Si true, solo simula los cambios sin aplicarlos (vista previa)',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  preview: boolean;

  @ApiPropertyOptional({
    type: String,
    description: 'Razón del ajuste masivo (opcional)',
    example: 'Ajuste por inflación trimestral',
  })
  @IsOptional()
  @IsString()
  razon?: string;
}

export class CambioProductoPrecioDto {
  @ApiProperty({ description: 'ID del producto' })
  productoId: string;

  @ApiProperty({ description: 'Nombre del producto' })
  nombre: string;

  @ApiProperty({ description: 'Precio anterior' })
  precioAnterior: number;

  @ApiProperty({ description: 'Precio nuevo después del ajuste' })
  precioNuevo: number;

  @ApiProperty({ description: 'Diferencia en soles' })
  diferencia: number;

  @ApiProperty({ description: 'Diferencia en porcentaje' })
  diferenciaPercentual: number;

  @ApiPropertyOptional({ description: 'ID de la variante (si aplica)' })
  varianteId?: string;

  @ApiPropertyOptional({ description: 'Nombre de la variante (si aplica)' })
  varianteNombre?: string;
}

export class ResumenAjusteMasivoDto {
  @ApiProperty({ description: 'Total de productos afectados' })
  totalProductosAfectados: number;

  @ApiProperty({ description: 'Total de variantes afectadas' })
  totalVariantesAfectadas: number;

  @ApiProperty({ description: 'Incremento/decremento promedio en porcentaje' })
  ajustePromedio: number;

  @ApiProperty({ description: 'Tipo de operación aplicada' })
  operacion: string;

  @ApiProperty({ description: 'Valor del ajuste aplicado' })
  valorAjuste: number;
}

export class AjusteMasivoPreciosResponseDto {
  @ApiProperty({ description: 'Resumen del ajuste' })
  resumen: ResumenAjusteMasivoDto;

  @ApiProperty({ type: [CambioProductoPrecioDto], description: 'Lista de cambios aplicados/propuestos' })
  cambios: CambioProductoPrecioDto[];

  @ApiPropertyOptional({ type: [String], description: 'Advertencias (si las hay)' })
  advertencias?: string[];

  @ApiProperty({ description: 'Si fue preview (true) o se aplicaron los cambios (false)' })
  esPreview: boolean;
}
