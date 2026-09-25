import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsIn, IsNumber, Max, MaxLength, Min } from 'class-validator';
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
  @ApiProperty({
    description: 'Solo esta empresa (tienda web). Sin él se compra todo el carrito, como en el app.',
    required: false,
  })
  @IsOptional()
  @IsString()
  empresaId?: string;

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

  @ApiProperty({
    description: 'Envío a domicilio: DELIVERY_LOCAL (reparto en la ciudad) o AGENCIA (a provincia)',
    enum: ['DELIVERY_LOCAL', 'AGENCIA'],
    required: false,
  })
  @IsOptional()
  @IsIn(['DELIVERY_LOCAL', 'AGENCIA'])
  modalidadEnvio?: 'DELIVERY_LOCAL' | 'AGENCIA';

  @ApiProperty({ description: 'AGENCIA: la agencia (Shalom, Olva…)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  agenciaEnvio?: string;

  @ApiProperty({ description: 'AGENCIA: la sede de la agencia en el destino', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  agenciaDireccionEnvio?: string;

  @ApiProperty({ description: 'DELIVERY_LOCAL: ubicación compartida por el comprador', required: false })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitudEnvio?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitudEnvio?: number;

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
