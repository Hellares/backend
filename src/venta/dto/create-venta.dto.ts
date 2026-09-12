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
import { CreatePagoVentaDto } from './create-pago-venta.dto';
import { MetodoPagoVenta, CanalVenta } from '@prisma/client';

export class CreateVentaDto {
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

  @ApiPropertyOptional({ description: 'Metodo de pago principal', enum: MetodoPagoVenta })
  @IsOptional()
  @IsEnum(MetodoPagoVenta)
  metodoPago?: MetodoPagoVenta;

  @ApiPropertyOptional({ description: 'Monto recibido' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoRecibido?: number;

  @ApiPropertyOptional({ description: 'Pagos múltiples (multi-medio). Cada pago lleva su banco/referencia.', type: [CreatePagoVentaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePagoVentaDto)
  pagos?: CreatePagoVentaDto[];

  @ApiPropertyOptional({ description: 'El cajero confirmó la advertencia legal de Ley 28194 cuando el efectivo excede el límite. Cliente asume riesgo.' })
  @IsOptional()
  @IsBoolean()
  aceptaRiesgoBancarizacion?: boolean;

  @ApiPropertyOptional({
    description:
      'Venta CON ENVÍO (pedido por teléfono/WhatsApp que se despacha por agencia)',
  })
  @IsOptional()
  @IsBoolean()
  conEnvio?: boolean;

  @ApiPropertyOptional({ description: 'Es venta a credito' })
  @IsOptional()
  @IsBoolean()
  esCredito?: boolean;

  @ApiPropertyOptional({ description: 'Plazo de credito en dias' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  plazoCredito?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago' })
  @IsOptional()
  @IsDateString()
  fechaVencimientoPago?: string;

  @ApiPropertyOptional({ description: 'Observaciones' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    description:
      'Fotos de la venta (como se vendio, como se entrega) subidas antes de crearla ' +
      'con POST /ventas/evidencia. Se enlazan a la venta al crearla. Es evidencia ' +
      'INTERNA: no viaja al comprobante ni al ticket del cliente.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenciaIds?: string[];

  @ApiPropertyOptional({
    description:
      'ID del usuario GERENTE/ADMIN que autorizó vender bajo costo. Requerido si alguna línea tiene margen negativo y el producto NO está en liquidación.',
  })
  @IsOptional()
  @IsString()
  ventaBajoCostoAutorizadaPorId?: string;
  @ApiPropertyOptional({
    description:
      'ID del usuario GERENTE/ADMIN que autorizó vender un producto pasado de ' +
      'su fecha de CONSUMO PREFERENTE. Campo APARTE de ' +
      '`ventaBajoCostoAutorizadaPorId` a propósito: son dos decisiones ' +
      'distintas, y reusar uno haría que autorizar un precio bajo autorizara ' +
      'además vender mercadería pasada de fecha. No sirve para CADUCIDAD: ' +
      'eso no se autoriza, se bloquea.',
  })
  @IsOptional()
  @IsString()
  ventaVencidaAutorizadaPorId?: string;


  @ApiProperty({ description: 'Detalles de la venta', type: [CreateVentaDetalleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateVentaDetalleDto)
  detalles: CreateVentaDetalleDto[];
}
