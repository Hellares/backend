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

  @ApiPropertyOptional({ description: 'Banco/entidad financiera (requerido si total>=2000 PEN o 500 USD y metodo es TARJETA/TRANSFERENCIA)' })
  @IsOptional()
  @IsString()
  bancoPago?: string;

  @ApiPropertyOptional({ description: 'N° de operación bancaria (requerido si total>=2000 PEN o 500 USD y metodo no es EFECTIVO/CREDITO)' })
  @IsOptional()
  @IsString()
  referenciaPago?: string;

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

  @ApiProperty({ description: 'Detalles de la venta', type: [CreateVentaDetalleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateVentaDetalleDto)
  detalles: CreateVentaDetalleDto[];
}
