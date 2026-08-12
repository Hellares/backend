import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVentaDetalleDto {
  @ApiPropertyOptional({ description: 'ID del producto' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ description: 'ID de la variante' })
  @IsOptional()
  @IsString()
  varianteId?: string;

  @ApiPropertyOptional({ description: 'ID del servicio' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiPropertyOptional({ description: 'ID del combo' })
  @IsOptional()
  @IsString()
  comboId?: string;

  @ApiPropertyOptional({
    description:
      'ID de la orden de servicio que se cobra con esta línea (solo POS ' +
      'crearYCobrar). La orden debe estar REPARADO/LISTO_ENTREGA y el ' +
      'precioUnitario debe coincidir con su saldo pendiente. Excluyente ' +
      'con productoId/varianteId/comboId; cantidad debe ser 1.',
  })
  @IsOptional()
  @IsString()
  ordenServicioId?: string;

  @ApiProperty({ description: 'Descripcion del item' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({
    description:
      'Identificadores por unidad (IMEI, N° de serie, placa). Obligatorio y ' +
      'con EXACTAMENTE `cantidad` valores cuando el producto tiene ' +
      'requiereIdentificador. El servidor los sella en la descripción de la ' +
      'línea, que es lo que se imprime y lo que viaja a SUNAT.',
    example: ['351234567890123', '351234567890124'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  identificadores?: string[];

  @ApiPropertyOptional({
    description:
      'Nota opcional por unidad, en el MISMO orden que identificadores ' +
      '("NEGRO 128GB"). Va entre paréntesis en la descripción de la línea. ' +
      'No se guarda como columna aparte: es descriptiva y su lugar es el ' +
      'texto del comprobante — el identificador se guarda limpio para poder ' +
      'buscarlo exacto ante un reclamo de garantía.',
    example: ['NEGRO 128GB', 'AZUL 256GB'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  notasIdentificador?: string[];

  @ApiProperty({ description: 'Cantidad', example: 1 })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario', example: 100 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  precioUnitario: number;

  @ApiPropertyOptional({ description: 'Descuento por linea', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Porcentaje de IGV', example: 18 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  porcentajeIGV?: number;

  @ApiPropertyOptional({ description: 'Si true, el precioUnitario ya incluye IGV', example: true })
  @IsOptional()
  precioIncluyeIgv?: boolean;

  @ApiPropertyOptional({ description: 'Tipo afectación IGV SUNAT (10=Gravado, 20=Exonerado, 30=Inafecto)', example: '10' })
  @IsOptional()
  @IsString()
  tipoAfectacion?: string;

  @ApiPropertyOptional({ description: 'Monto ICBPER por este item', example: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  icbper?: number;

  @ApiPropertyOptional({
    description:
      'ID del combo origen cuando este item es un componente de un combo expandido. ' +
      'El cliente Flutter expande los combos en items individuales con `productoId`, ' +
      'pero conserva esta referencia para trazabilidad post-venta (reportes, auditoría).',
  })
  @IsOptional()
  @IsString()
  origenComboId?: string;

  @ApiPropertyOptional({
    description: 'Snapshot del nombre del combo origen (no se pierde si el combo se renombra/elimina luego).',
  })
  @IsOptional()
  @IsString()
  origenComboNombre?: string;
}
