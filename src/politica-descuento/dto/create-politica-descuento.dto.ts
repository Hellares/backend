import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsInt,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TipoDescuento {
  TRABAJADOR = 'TRABAJADOR',
  FAMILIAR_TRABAJADOR = 'FAMILIAR_TRABAJADOR',
  VIP = 'VIP',
  PROMOCIONAL = 'PROMOCIONAL',
  LEALTAD = 'LEALTAD',
  CUMPLEANIOS = 'CUMPLEANIOS',
}

export enum TipoCalculoDescuento {
  PORCENTAJE = 'PORCENTAJE',
  MONTO_FIJO = 'MONTO_FIJO',
  PRECIO_COSTO = 'PRECIO_COSTO',
  PRECIO_MAYOR_DESDE_UNIDAD = 'PRECIO_MAYOR_DESDE_UNIDAD',
}

export enum EstrategiaMayor {
  PRIMER_NIVEL = 'PRIMER_NIVEL',
  MEJOR_NIVEL = 'MEJOR_NIVEL',
}

export class CreatePoliticaDescuentoDto {
  @ApiProperty({
    description: 'Nombre de la política de descuento',
    example: 'Descuento Trabajadores 15%',
  })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional({
    description: 'Descripción de la política',
    example: 'Descuento aplicable a todos los trabajadores de la empresa',
  })
  @IsString()
  @IsOptional()
  descripcion?: string;

  @ApiProperty({
    description: 'Tipo de descuento',
    enum: TipoDescuento,
    example: TipoDescuento.TRABAJADOR,
  })
  @IsEnum(TipoDescuento)
  @IsNotEmpty()
  tipoDescuento: TipoDescuento;

  @ApiProperty({
    description: 'Tipo de cálculo del descuento',
    enum: TipoCalculoDescuento,
    example: TipoCalculoDescuento.PORCENTAJE,
  })
  @IsEnum(TipoCalculoDescuento)
  @IsNotEmpty()
  tipoCalculo: TipoCalculoDescuento;

  @ApiProperty({
    description:
      'Valor del descuento (porcentaje o monto fijo según tipoCalculo)',
    example: 15.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  valorDescuento: number;

  @ApiPropertyOptional({
    description: 'Descuento máximo permitido en monto',
    example: 500.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  descuentoMaximo?: number;

  @ApiPropertyOptional({
    description: 'Monto mínimo de compra requerido para aplicar el descuento',
    example: 100.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  montoMinCompra?: number;

  @ApiPropertyOptional({
    description: 'Límite de usos por usuario',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  cantidadMaxUsos?: number;

  @ApiPropertyOptional({
    description: 'Fecha de inicio de vigencia',
    example: '2024-01-01T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin de vigencia',
    example: '2024-12-31T23:59:59Z',
  })
  @IsDateString()
  @IsOptional()
  fechaFin?: string;

  @ApiProperty({
    description: 'Si true, aplica a todos los productos',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  aplicarATodos?: boolean;

  @ApiProperty({
    description: 'Prioridad de la política (mayor número = mayor prioridad)',
    example: 10,
    default: 0,
  })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  prioridad?: number;

  @ApiPropertyOptional({
    description:
      'Límite de familiares por trabajador (solo para FAMILIAR_TRABAJADOR)',
    example: 3,
  })
  @ValidateIf((o) => o.tipoDescuento === TipoDescuento.FAMILIAR_TRABAJADOR)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  @Type(() => Number)
  maxFamiliaresPorTrabajador?: number;

  @ApiPropertyOptional({
    description:
      'Markup % sobre el costo (solo tipoCalculo PRECIO_COSTO). 0 = costo puro.',
    example: 5,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  markupSobreCosto?: number;

  @ApiPropertyOptional({
    description:
      'Estrategia de escalón (solo tipoCalculo PRECIO_MAYOR_DESDE_UNIDAD).',
    enum: EstrategiaMayor,
    example: EstrategiaMayor.PRIMER_NIVEL,
  })
  @IsEnum(EstrategiaMayor)
  @IsOptional()
  estrategiaMayor?: EstrategiaMayor;
}
