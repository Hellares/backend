import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateVentaDetalleDto } from './create-venta-detalle.dto';
import { MetodoPagoVenta, CanalVenta } from '@prisma/client';

export class CrearYCobrarVentaDto {
  @ApiPropertyOptional({ description: 'Canal de venta', enum: CanalVenta })
  @IsOptional()
  @IsEnum(CanalVenta)
  canalVenta?: CanalVenta;
  @ApiProperty({ description: 'ID de la sede' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiPropertyOptional({ description: 'ID del cliente (EmpresaPersona)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente empresa' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiProperty({ description: 'ID del vendedor (Usuario)' })
  @IsString()
  @IsNotEmpty()
  vendedorId: string;

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

  @ApiProperty({ description: 'Detalles de la venta', type: [CreateVentaDetalleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateVentaDetalleDto)
  detalles: CreateVentaDetalleDto[];

  // --- Campos de pago y comprobante ---

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

  @ApiPropertyOptional({ description: 'Porcentaje de interes para credito' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  porcentajeInteres?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago' })
  @IsOptional()
  @IsDateString()
  fechaVencimientoPago?: string;

  @ApiPropertyOptional({ description: 'Metodo de pago principal', enum: MetodoPagoVenta })
  @IsOptional()
  @IsEnum(MetodoPagoVenta)
  metodoPago?: MetodoPagoVenta;

  @ApiPropertyOptional({ description: 'Monto recibido (pago unico legacy)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoRecibido?: number;

  @ApiPropertyOptional({ description: 'Referencia del pago (pago unico legacy, también usado como N° operación para bancarización)' })
  @IsOptional()
  @IsString()
  referenciaPago?: string;

  @ApiPropertyOptional({ description: 'Banco/entidad financiera (requerido para bancarización Ley 28194 con TARJETA/TRANSFERENCIA)' })
  @IsOptional()
  @IsString()
  bancoPago?: string;

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

  @ApiPropertyOptional({ description: 'Tipo de comprobante', example: 'BOLETA' })
  @IsOptional()
  @IsString()
  tipoComprobante?: string;

  @ApiPropertyOptional({ description: 'Tipo de documento del cliente', example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDocumentoCliente?: string;

  @ApiPropertyOptional({ description: 'ID de la sede emisora (si difiere de la sede operativa). Para multi-RUC.' })
  @IsOptional()
  @IsString()
  sedeFacturacionId?: string;

  @ApiPropertyOptional({ description: 'Condicion de pago', example: 'CONTADO' })
  @IsOptional()
  @IsString()
  condicionPago?: string;

  // --- Descuento global con autorización ---

  @ApiPropertyOptional({ description: 'Monto del descuento global sobre el total' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  descuentoGlobal?: number;

  @ApiPropertyOptional({ description: 'Porcentaje del descuento global (referencia)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  descuentoGlobalPorcentaje?: number;

  @ApiPropertyOptional({ description: 'ID del usuario que autorizó el descuento' })
  @IsOptional()
  @IsString()
  descuentoAutorizadoPorId?: string;
}
