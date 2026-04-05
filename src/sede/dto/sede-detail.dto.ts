import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoSede, SedeRole } from '@prisma/client';

export class SedeDetailDto {
  @ApiProperty({ description: 'ID de la sede' })
  id: string;

  @ApiProperty({ description: 'ID de la empresa' })
  empresaId: string;

  @ApiProperty({ description: 'Código único de la sede' })
  codigo: string;

  @ApiProperty({ description: 'Nombre de la sede' })
  nombre: string;

  @ApiPropertyOptional({ description: 'Teléfono de la sede' })
  telefono?: string;

  @ApiPropertyOptional({ description: 'Email de la sede' })
  email?: string;

  @ApiProperty({
    description: 'Tipo de operación de la sede',
    enum: TipoSede,
  })
  tipoSede: TipoSede;

  @ApiPropertyOptional({ description: 'Dirección completa' })
  direccion?: string;

  @ApiPropertyOptional({ description: 'Referencia de ubicación' })
  referencia?: string;

  @ApiPropertyOptional({ description: 'Distrito' })
  distrito?: string;

  @ApiPropertyOptional({ description: 'Provincia' })
  provincia?: string;

  @ApiPropertyOptional({ description: 'Departamento' })
  departamento?: string;

  @ApiPropertyOptional({ description: 'País', default: 'PERU' })
  pais?: string;

  @ApiPropertyOptional({
    description: 'Coordenadas geográficas',
    example: { lat: -12.0464, lon: -77.0428 },
  })
  coordenadas?: any;

  @ApiPropertyOptional({
    description: 'Horario de atención',
    example: { lunes: { inicio: '09:00', fin: '18:00' } },
  })
  horarioAtencion?: any;

  @ApiPropertyOptional({ description: 'Configuración específica' })
  configuracion?: any;

  @ApiProperty({ description: 'Serie para facturas' })
  serieFactura: string;

  @ApiProperty({ description: 'Serie para boletas' })
  serieBoleta: string;

  @ApiProperty({ description: 'Serie para notas de crédito' })
  serieNotaCredito: string;

  @ApiProperty({ description: 'Serie para notas de débito' })
  serieNotaDebito: string;

  @ApiPropertyOptional({ description: 'Serie para guías de remisión' })
  serieGuiaRemision?: string;

  // Facturación electrónica por sede
  @ApiPropertyOptional({ description: 'RUC propio de la sede' })
  rucSede?: string;

  @ApiPropertyOptional({ description: 'Razón social del contribuyente' })
  razonSocialSede?: string;

  @ApiPropertyOptional({ description: 'Dirección fiscal SUNAT' })
  direccionFiscalSede?: string;

  @ApiPropertyOptional({ description: 'URL API proveedor facturación' })
  proveedorRuta?: string;

  @ApiPropertyOptional({ description: 'Token proveedor facturación' })
  proveedorToken?: string;

  @ApiPropertyOptional({ description: 'Facturación activa' })
  facturacionActiva?: boolean;

  @ApiPropertyOptional({ description: 'Resolución SUNAT' })
  resolucionSunat?: string;

  @ApiProperty({ description: 'Último número de factura emitido' })
  ultimoNumeroFactura: number;

  @ApiProperty({ description: 'Último número de boleta emitida' })
  ultimoNumeroBoleta: number;

  @ApiProperty({ description: 'Último número de nota de crédito' })
  ultimoNumeroNotaCredito: number;

  @ApiProperty({ description: 'Último número de nota de débito' })
  ultimoNumeroNotaDebito: number;

  @ApiProperty({ description: 'Último número de guía de remisión' })
  ultimoNumeroGuiaRemision: number;

  @ApiProperty({ description: 'Indica si la sede está activa' })
  isActive: boolean;

  @ApiPropertyOptional({ description: 'Fecha de eliminación lógica' })
  deletedAt?: Date;

  @ApiProperty({ description: 'Indica si es la sede principal' })
  esPrincipal: boolean;

  @ApiProperty({ description: 'Fecha de creación' })
  creadoEn: Date;

  @ApiProperty({ description: 'Fecha de última actualización' })
  actualizadoEn: Date;

  @ApiPropertyOptional({
    description: 'Rol del usuario en esta sede (si tiene uno asignado)',
    enum: SedeRole,
  })
  userRole?: SedeRole;

  @ApiPropertyOptional({ description: 'Total de usuarios asignados a la sede' })
  totalUsuarios?: number;

  @ApiPropertyOptional({ description: 'Total de productos en la sede' })
  totalProductos?: number;

  @ApiPropertyOptional({ description: 'Total de servicios en la sede' })
  totalServicios?: number;
}
