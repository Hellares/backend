import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCotizacionDetalleDto } from './create-cotizacion-detalle.dto';

export class UpdateCotizacionDto {
  @ApiPropertyOptional({
    description: 'ID del cliente EMPRESA (ClienteEmpresa). Excluyente con clienteId.',
  })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente (EmpresaPersona)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del vendedor (Usuario)' })
  @IsOptional()
  @IsString()
  vendedorId?: string;

  @ApiPropertyOptional({ description: 'Nombre/titulo de la cotizacion', example: 'PC GAMER PROFESIONAL' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente' })
  @IsOptional()
  @IsString()
  nombreCliente?: string;

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

  @ApiPropertyOptional({ description: 'Detalles actualizados', type: [CreateCotizacionDetalleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCotizacionDetalleDto)
  detalles?: CreateCotizacionDetalleDto[];
}
