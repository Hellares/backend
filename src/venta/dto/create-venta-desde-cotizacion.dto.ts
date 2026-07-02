import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsDateString,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MetodoPagoVenta, CanalVenta } from '@prisma/client';

export class CreateVentaDesdeCotizacionDto {
  @ApiPropertyOptional({ description: 'Metodo de pago principal', enum: MetodoPagoVenta })
  @IsOptional()
  @IsEnum(MetodoPagoVenta)
  metodoPago?: MetodoPagoVenta;

  @ApiPropertyOptional({ description: 'Monto recibido' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoRecibido?: number;

  @ApiPropertyOptional({ description: 'Es venta a credito' })
  @IsOptional()
  @IsBoolean()
  esCredito?: boolean;

  @ApiPropertyOptional({ description: 'Plazo de credito en dias' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  plazoCredito?: number;

  @ApiPropertyOptional({ description: 'Numero de cuotas para credito' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numeroCuotas?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago' })
  @IsOptional()
  @IsDateString()
  fechaVencimientoPago?: string;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Tipo de comprobante', example: 'BOLETA' })
  @IsOptional()
  @IsString()
  tipoComprobante?: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del cliente', example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDocumentoCliente?: string;

  @ApiPropertyOptional({ description: 'Condicion de pago', example: 'CONTADO' })
  @IsOptional()
  @IsString()
  condicionPago?: string;

  @ApiPropertyOptional({ description: 'Pagos multiples' })
  @IsOptional()
  @IsArray()
  pagos?: Array<{
    metodoPago: string;
    monto: number;
    referencia?: string;
    monedaOriginal?: string;
    montoOriginal?: number;
    tipoCambio?: number;
  }>;

  @ApiPropertyOptional({ description: 'IDs de detalles a excluir (sin stock)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excluirDetalleIds?: string[];

  @ApiPropertyOptional({ description: 'Ajustes de cantidad por detalleId (stock parcial)', example: { 'detalleId1': 10 } })
  @IsOptional()
  ajustarCantidades?: Record<string, number>;

  // ── Descuentos aplicados al COBRAR (cola POS) ──

  @ApiPropertyOptional({
    description: 'Descuento por línea: {detalleId: monto total de descuento de esa línea}',
    example: { detalleId1: 5.5 },
  })
  @IsOptional()
  ajustarDescuentos?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Descuento global en monto (se resta del total final)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoGlobal?: number;

  @ApiPropertyOptional({ description: 'Porcentaje del descuento global (informativo)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoGlobalPorcentaje?: number;

  @ApiPropertyOptional({ description: 'Usuario que autorizó el descuento' })
  @IsOptional()
  @IsString()
  descuentoAutorizadoPorId?: string;

  @ApiPropertyOptional({ description: 'Items adicionales agregados por el cajero' })
  @IsOptional()
  @IsArray()
  itemsAdicionales?: Array<{
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento?: number;
    porcentajeIGV?: number;
    tipoAfectacion?: string;
    icbper?: number;
    productoId?: string;
    varianteId?: string;
    servicioId?: string;
  }>;

  @ApiPropertyOptional({
    description:
      'ID del usuario GERENTE/ADMIN que autorizó vender bajo costo. Requerido si alguna línea convertida tiene margen negativo y el producto NO está en liquidación.',
  })
  @IsOptional()
  @IsString()
  ventaBajoCostoAutorizadaPorId?: string;
}
