import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MetodoPagoMarketplace, TipoEntregaMarketplace } from '@prisma/client';

export class EntregaEmpresaDto {
  @ApiProperty({ description: 'ID de la empresa' })
  @IsString()
  empresaId: string;

  @ApiProperty({ description: 'Tipo de entrega', enum: TipoEntregaMarketplace })
  @IsEnum(TipoEntregaMarketplace)
  tipoEntrega: TipoEntregaMarketplace;

  @ApiProperty({ description: 'ID de sede para retiro (si retiro en tienda)', required: false })
  @IsOptional()
  @IsString()
  sedeRetiroId?: string;
}

export class CheckoutDto {
  @ApiProperty({ description: 'Método de pago', enum: MetodoPagoMarketplace })
  @IsEnum(MetodoPagoMarketplace)
  metodoPago: MetodoPagoMarketplace;

  @ApiProperty({ description: 'ID de dirección de envío guardada', required: false })
  @IsOptional()
  @IsString()
  direccionEnvioId?: string;

  @ApiProperty({ description: 'Dirección de envío (si no usa guardada)', required: false })
  @IsOptional()
  @IsString()
  direccionEnvio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  referenciaEnvio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  distritoEnvio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provinciaEnvio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  departamentoEnvio?: string;

  @ApiProperty({ description: 'Notas del comprador', required: false })
  @IsOptional()
  @IsString()
  notasComprador?: string;

  @ApiProperty({ description: 'Opciones de entrega por empresa', required: false, type: [EntregaEmpresaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntregaEmpresaDto)
  entregaPorEmpresa?: EntregaEmpresaDto[];
}

export class SubirComprobanteDto {
  @ApiProperty({ description: 'Método de pago usado', enum: MetodoPagoMarketplace, required: false })
  @IsOptional()
  @IsEnum(MetodoPagoMarketplace)
  metodoPago?: MetodoPagoMarketplace;
}
