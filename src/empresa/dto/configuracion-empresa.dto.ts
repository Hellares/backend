import { IsString, IsNumber, IsInt, IsOptional, IsArray, IsBoolean, Min, Max, ArrayNotEmpty } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Etiqueta para la sección equipo', example: 'VEHICULO' })
  @IsOptional()
  @IsString()
  etiquetaSeccionEquipo?: string;

  @ApiPropertyOptional({ description: 'Etiqueta para tipo de equipo', example: 'Tipo de vehículo' })
  @IsOptional()
  @IsString()
  etiquetaTipoEquipo?: string;

  @ApiPropertyOptional({ description: 'Etiqueta para marca', example: 'Marca/Modelo' })
  @IsOptional()
  @IsString()
  etiquetaMarcaEquipo?: string;

  @ApiPropertyOptional({ description: 'Etiqueta para número de serie', example: 'Placa' })
  @IsOptional()
  @IsString()
  etiquetaNumeroSerie?: string;

  @ApiPropertyOptional({ description: 'Etiqueta para condición', example: 'Estado del vehículo' })
  @IsOptional()
  @IsString()
  etiquetaCondicionEquipo?: string;

  @ApiPropertyOptional({ description: 'Mostrar/ocultar sección equipo', default: true })
  @IsOptional()
  @IsBoolean()
  mostrarSeccionEquipo?: boolean;

  // Interés por crédito
  @ApiPropertyOptional({ description: 'Habilitar interés por crédito', default: false })
  @IsOptional()
  @IsBoolean()
  interesHabilitado?: boolean;

  @ApiPropertyOptional({ description: 'Porcentaje de interés por defecto', example: 5.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeInteresDefault?: number;

  @ApiPropertyOptional({ description: 'Vendedor puede cambiar el porcentaje', default: true })
  @IsOptional()
  @IsBoolean()
  interesEsEditable?: boolean;

  // Mora
  @ApiPropertyOptional({ description: 'Habilitar mora por cuotas vencidas', default: false })
  @IsOptional()
  @IsBoolean()
  moraHabilitada?: boolean;

  @ApiPropertyOptional({ description: 'Porcentaje mora diario', example: 0.05 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  porcentajeMoraDiario?: number;

  @ApiPropertyOptional({ description: 'Mora máxima como % del monto cuota', example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  moraMaximaPorcentaje?: number;

  @ApiPropertyOptional({ description: 'Días de gracia antes de aplicar mora', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  diasGraciaMora?: number;
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

  @ApiPropertyOptional()
  etiquetaSeccionEquipo?: string;

  @ApiPropertyOptional()
  etiquetaTipoEquipo?: string;

  @ApiPropertyOptional()
  etiquetaMarcaEquipo?: string;

  @ApiPropertyOptional()
  etiquetaNumeroSerie?: string;

  @ApiPropertyOptional()
  etiquetaCondicionEquipo?: string;

  @ApiProperty({ default: true })
  mostrarSeccionEquipo: boolean;

  @ApiProperty()
  creadoEn: Date;

  @ApiProperty()
  actualizadoEn: Date;
}
