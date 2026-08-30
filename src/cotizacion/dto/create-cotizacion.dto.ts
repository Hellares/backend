import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCotizacionDetalleDto } from './create-cotizacion-detalle.dto';

export class CreateCotizacionDto {
  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiPropertyOptional({
    description:
      'ID del cliente EMPRESA (ClienteEmpresa). Excluyente con clienteId: ' +
      'son tablas distintas y cada uno tiene su FK.',
  })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente (EmpresaPersona)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiProperty({ description: 'ID del vendedor (Usuario)' })
  @IsString()
  @IsNotEmpty()
  vendedorId: string;

  @ApiPropertyOptional({ description: 'Nombre/titulo de la cotizacion', example: 'PC GAMER PROFESIONAL' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiProperty({ description: 'Nombre del cliente' })
  @IsString()
  @IsNotEmpty()
  nombreCliente: string;

  @ApiPropertyOptional({ description: 'Documento del cliente' })
  @IsOptional()
  @IsString()
  documentoCliente?: string;

  @ApiPropertyOptional({ description: 'Email del cliente' })
  @IsOptional()
  @IsString()
  emailCliente?: string;

  @ApiPropertyOptional({ description: 'Telefono del cliente' })
  @IsOptional()
  @IsString()
  telefonoCliente?: string;

  @ApiPropertyOptional({ description: 'Direccion del cliente' })
  @IsOptional()
  @IsString()
  direccionCliente?: string;

  @ApiPropertyOptional({ description: 'Moneda', example: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiPropertyOptional({ description: 'Tipo de cambio' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tipoCambio?: number;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Condiciones comerciales' })
  @IsOptional()
  @IsString()
  condiciones?: string;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento' })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiProperty({ description: 'Detalles de la cotizacion', type: [CreateCotizacionDetalleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCotizacionDetalleDto)
  detalles: CreateCotizacionDetalleDto[];

  // ── Reserva de stock + pago adelantado (opcional) ──
  // Si `reservarStock=true`, el backend aparta el stock de cada item
  // del catálogo (incrementa `ProductoStock.stockReservadoCotizacion`)
  // y guarda `productoStockId`+`cantidadReservada`+`reservaEstado=ACTIVA`
  // en cada `CotizacionDetalle`. Al anular se libera; al convertir a
  // venta se consume.
  @ApiPropertyOptional({ description: 'Apartar stock para esta cotización' })
  @IsOptional()
  @IsBoolean()
  reservarStock?: boolean;

  // Monto del pago adelantado del cliente. Si > 0, se crea un
  // MovimientoCaja(INGRESO, ADELANTO_COTIZACION) vinculado a esta
  // cotización. Requiere `cajaId`.
  @ApiPropertyOptional({ description: 'Monto del pago adelantado del cliente' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adelantoMonto?: number;

  // ID de la caja donde se registra el adelanto. Obligatorio si
  // `adelantoMonto > 0`.
  @ApiPropertyOptional({ description: 'ID de la caja para registrar el adelanto' })
  @IsOptional()
  @IsString()
  cajaId?: string;

  // Adelanto que se le PIDE al cliente del marketplace para SEPARAR los
  // productos (lo paga con Yape automático al aceptar la cotización; el
  // webhook lo vuelve `adelantoMonto` + reserva de stock).
  @ApiPropertyOptional({ description: 'Adelanto requerido para separar (marketplace)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adelantoRequerido?: number;
}
