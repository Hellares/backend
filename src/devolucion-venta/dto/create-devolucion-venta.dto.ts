import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MotivoDevolucion,
  EstadoProductoDevolucion,
  AccionDevolucion,
} from '@prisma/client';

export class CreateDevolucionItemDto {
  @ApiPropertyOptional({ description: 'ID del producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiProperty({ description: 'Cantidad a devolver', minimum: 1 })
  @IsNumber()
  @Min(1)
  cantidad: number;

  @ApiProperty({ description: 'Motivo de la devolución', enum: MotivoDevolucion })
  @IsEnum(MotivoDevolucion)
  motivo: MotivoDevolucion;

  @ApiProperty({ description: 'Estado del producto devuelto', enum: EstadoProductoDevolucion })
  @IsEnum(EstadoProductoDevolucion)
  estadoProducto: EstadoProductoDevolucion;

  @ApiProperty({ description: 'Acción a tomar con el producto', enum: AccionDevolucion })
  @IsEnum(AccionDevolucion)
  accion: AccionDevolucion;

  @ApiPropertyOptional({ description: 'Observaciones del item' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'ID del producto de reemplazo' })
  @IsOptional()
  @IsString()
  productoReemplazoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante de reemplazo' })
  @IsOptional()
  @IsString()
  varianteReemplazoId?: string;
}

export class CreateDevolucionVentaDto {
  @ApiProperty({ description: 'ID de la venta' })
  @IsString()
  @IsNotEmpty()
  ventaId: string;

  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiPropertyOptional({ description: 'Motivo general de la devolución' })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({ description: 'Observaciones generales' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Tipo de reembolso', enum: ['EFECTIVO', 'CAMBIO_PRODUCTO'] })
  @IsOptional()
  @IsString()
  tipoReembolso?: string;

  @ApiProperty({ description: 'Items a devolver', type: [CreateDevolucionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDevolucionItemDto)
  items: CreateDevolucionItemDto[];
}
