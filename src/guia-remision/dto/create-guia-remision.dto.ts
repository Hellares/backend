import {
  IsString, IsNotEmpty, IsOptional, IsInt, IsArray, IsNumber, IsEnum,
  Min, Max, MinLength, MaxLength, ValidateNested, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GuiaRemisionDetalleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() varianteId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(5) unidadMedida: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) codigo?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250) descripcion: string;
  @ApiProperty() @IsNumber() @Min(0.001) @Type(() => Number) cantidad: number;
  @ApiPropertyOptional() @IsOptional() @IsString() codigoDam?: string;
}

export class GuiaRemisionDocRelacionadoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(2) tipo: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4) serie: string;
  @ApiProperty() @IsInt() @Min(1) @Type(() => Number) numero: number;
}

export class GuiaRemisionVehiculoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(8) placaNumero: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) tuc?: string;
}

export class GuiaRemisionConductorDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(1) documentoTipo: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(15) documentoNumero: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250) nombre: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250) apellidos: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10) numeroLicencia: string;
}

export class CreateGuiaRemisionDto {
  @ApiProperty() @IsString() @IsNotEmpty() sedeId: string;

  @ApiProperty({ enum: ['REMITENTE', 'TRANSPORTISTA'] })
  @IsEnum(['REMITENTE', 'TRANSPORTISTA'])
  tipo: 'REMITENTE' | 'TRANSPORTISTA';

  // Fecha inicio traslado
  @ApiProperty() @IsDateString() fechaInicioTraslado: string;

  // Motivo
  @ApiProperty({
    enum: [
      'VENTA', 'COMPRA', 'VENTA_CON_ENTREGA_A_TERCEROS',
      'TRASLADO_ENTRE_ESTABLECIMIENTOS', 'CONSIGNACION', 'DEVOLUCION',
      'RECOJO_BIENES_TRANSFORMADOS', 'IMPORTACION', 'EXPORTACION',
      'OTROS', 'VENTA_SUJETA_A_CONFIRMACION',
      'TRASLADO_BIENES_TRANSFORMACION', 'TRASLADO_EMISOR_ITINERANTE',
    ],
  })
  @IsString() @IsNotEmpty()
  motivoTraslado: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(70)
  motivoTrasladoOtrosDescripcion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  observaciones?: string;

  // Peso
  @ApiProperty() @IsNumber() @Min(0.001) @Type(() => Number)
  pesoBrutoTotal: number;

  @ApiPropertyOptional({ default: 'KGM' }) @IsOptional() @IsString()
  pesoBrutoUnidadMedida?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  numeroBultos?: number;

  // Transporte (solo Remitente)
  @ApiPropertyOptional({ enum: ['PUBLICO', 'PRIVADO'] })
  @IsOptional() @IsEnum(['PUBLICO', 'PRIVADO'])
  tipoTransporte?: 'PUBLICO' | 'PRIVADO';

  // Destinatario (Remitente) / Remitente (Transportista)
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(1) clienteTipoDocumento: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(15) clienteNumeroDocumento: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) clienteDenominacion: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) clienteDireccion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) clienteEmail?: string;

  // Punto de partida
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(6) puntoPartidaUbigeo: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) puntoPartidaDireccion: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4)
  puntoPartidaCodigoEstablecimientoSunat?: string;

  // Punto de llegada
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(6) puntoLlegadaUbigeo: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) puntoLlegadaDireccion: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4)
  puntoLlegadaCodigoEstablecimientoSunat?: string;

  // Transportista (transporte público)
  @ApiPropertyOptional() @IsOptional() @IsString() transportistaDocumentoTipo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(11) transportistaDocumentoNumero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) transportistaDenominacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8) transportistaPlacaNumero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) transportistaMtc?: string;

  // Conductor principal (transporte privado)
  @ApiPropertyOptional() @IsOptional() @IsString() conductorDocumentoTipo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) conductorDocumentoNumero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) conductorNombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) conductorApellidos?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) conductorNumeroLicencia?: string;

  // TUC (solo GRE Transportista)
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) tucVehiculoPrincipal?: string;

  // Destinatario (solo GRE Transportista)
  @ApiPropertyOptional() @IsOptional() @IsString() destinatarioDocumentoTipo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) destinatarioDocumentoNumero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) destinatarioDenominacion?: string;

  // Indicador SUNAT
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2) sunatEnvioIndicador?: string;

  // Importación/Exportación
  @ApiPropertyOptional() @IsOptional() @IsString() documentoRelacionadoCodigo?: string;

  // Documento origen (vinculación)
  @ApiPropertyOptional() @IsOptional() @IsString() ventaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() compraId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() transferenciaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() devolucionId?: string;

  // Items
  @ApiProperty({ type: [GuiaRemisionDetalleDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => GuiaRemisionDetalleDto)
  items: GuiaRemisionDetalleDto[];

  // Documentos relacionados
  @ApiPropertyOptional({ type: [GuiaRemisionDocRelacionadoDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GuiaRemisionDocRelacionadoDto)
  documentosRelacionados?: GuiaRemisionDocRelacionadoDto[];

  // Vehículos secundarios (max 2)
  @ApiPropertyOptional({ type: [GuiaRemisionVehiculoDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GuiaRemisionVehiculoDto)
  vehiculosSecundarios?: GuiaRemisionVehiculoDto[];

  // Conductores secundarios (max 2)
  @ApiPropertyOptional({ type: [GuiaRemisionConductorDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GuiaRemisionConductorDto)
  conductoresSecundarios?: GuiaRemisionConductorDto[];
}
