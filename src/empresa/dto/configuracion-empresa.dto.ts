import { IsString, IsNumber, IsInt, IsOptional, IsArray, Min, Max, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfiguracionEmpresaDto {
  @ApiPropertyOptional({
    description: 'Porcentaje de impuesto por defecto (IGV)',
    example: 18.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  impuestoDefaultPorcentaje?: number;

  @ApiPropertyOptional({
    description: 'Nombre del impuesto para UI y documentos',
    example: 'IGV',
  })
  @IsOptional()
  @IsString()
  nombreImpuesto?: string;

  @ApiPropertyOptional({
    description: 'Código ISO de moneda principal',
    example: 'PEN',
  })
  @IsOptional()
  @IsString()
  monedaPrincipal?: string;

  @ApiPropertyOptional({
    description: 'Símbolo de moneda para mostrar',
    example: 'S/',
  })
  @IsOptional()
  @IsString()
  simboloMoneda?: string;

  @ApiPropertyOptional({
    description: 'Lista de monedas permitidas (códigos ISO)',
    example: ['PEN', 'USD'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  monedasPermitidas?: string[];

  @ApiPropertyOptional({
    description: 'Días de vigencia por defecto para cotizaciones',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  diasVigenciaCotizacion?: number;

  @ApiPropertyOptional({
    description: 'Texto de condiciones por defecto para cotizaciones',
    example: 'Precios no incluyen flete. Forma de pago: 50% adelanto.',
  })
  @IsOptional()
  @IsString()
  condicionesDefault?: string;
}

export class ConfiguracionEmpresaResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiProperty({ example: 18.0 })
  impuestoDefaultPorcentaje: number;

  @ApiProperty({ example: 'IGV' })
  nombreImpuesto: string;

  @ApiProperty({ example: 'PEN' })
  monedaPrincipal: string;

  @ApiProperty({ example: 'S/' })
  simboloMoneda: string;

  @ApiProperty({ example: ['PEN', 'USD'], type: [String] })
  monedasPermitidas: string[];

  @ApiProperty({ example: 30 })
  diasVigenciaCotizacion: number;

  @ApiPropertyOptional()
  condicionesDefault?: string;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;
}
