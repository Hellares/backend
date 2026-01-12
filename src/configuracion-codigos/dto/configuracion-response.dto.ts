import { ApiProperty } from '@nestjs/swagger';

class ConfigSeccionDto {
  @ApiProperty({ description: 'Prefijo del código' })
  codigo: string;

  @ApiProperty({ description: 'Separador entre prefijo y número' })
  separador: string;

  @ApiProperty({ description: 'Longitud del número con padding' })
  longitud: number;

  @ApiProperty({ description: 'Último contador utilizado' })
  ultimoContador: number;

  @ApiProperty({ description: 'Vista previa del próximo código' })
  proximoCodigo: string;
}

class ConfigProductosDto extends ConfigSeccionDto {
  @ApiProperty({ description: 'Incluir código de sede en el formato' })
  incluirSede: boolean;
}

class ConfigDocumentoDto {
  @ApiProperty({ description: 'Prefijo del código' })
  codigo: string;

  @ApiProperty({ description: 'Último contador utilizado' })
  ultimoContador: number;

  @ApiProperty({ description: 'Vista previa del próximo código' })
  proximoCodigo: string;
}

class ConfigDocumentosDto {
  @ApiProperty({ type: ConfigDocumentoDto })
  factura: ConfigDocumentoDto;

  @ApiProperty({ type: ConfigDocumentoDto })
  boleta: ConfigDocumentoDto;

  @ApiProperty({ type: ConfigDocumentoDto })
  notaCredito: ConfigDocumentoDto;

  @ApiProperty({ type: ConfigDocumentoDto })
  notaDebito: ConfigDocumentoDto;

  @ApiProperty({ description: 'Separador común para todos los documentos' })
  separador: string;

  @ApiProperty({ description: 'Longitud común para todos los documentos' })
  longitud: number;
}

class RestriccionesDto {
  @ApiProperty({ description: 'Si se puede modificar el prefijo de productos' })
  puedeModificarProductoCodigo: boolean;

  @ApiProperty({ description: 'Si se puede modificar el prefijo de variantes' })
  puedeModificarVarianteCodigo: boolean;

  @ApiProperty({ description: 'Si se puede modificar el prefijo de servicios' })
  puedeModificarServicioCodigo: boolean;

  @ApiProperty({ description: 'Razón por la que no se puede modificar productos', required: false })
  razonProducto?: string;

  @ApiProperty({ description: 'Razón por la que no se puede modificar variantes', required: false })
  razonVariante?: string;

  @ApiProperty({ description: 'Razón por la que no se puede modificar servicios', required: false })
  razonServicio?: string;
}

export class ConfiguracionResponseDto {
  @ApiProperty({ description: 'ID de la configuración' })
  id: string;

  @ApiProperty({ description: 'ID de la empresa' })
  empresaId: string;

  @ApiProperty({ description: 'Configuración de códigos de productos', type: ConfigProductosDto })
  productos: ConfigProductosDto;

  @ApiProperty({ description: 'Configuración de códigos de variantes', type: ConfigSeccionDto })
  variantes: ConfigSeccionDto;

  @ApiProperty({ description: 'Configuración de códigos de servicios', type: ConfigProductosDto })
  servicios: ConfigProductosDto;

  @ApiProperty({ description: 'Configuración de códigos de ventas (Notas de Venta)', type: ConfigProductosDto })
  ventas: ConfigProductosDto;

  @ApiProperty({ description: 'Configuración de códigos de documentos', type: ConfigDocumentosDto })
  documentos: ConfigDocumentosDto;

  @ApiProperty({ description: 'Restricciones de modificación', type: RestriccionesDto })
  restricciones: RestriccionesDto;

  @ApiProperty({ description: 'Fecha de creación' })
  creadoEn: Date;

  @ApiProperty({ description: 'Fecha de última actualización' })
  actualizadoEn: Date;
}
