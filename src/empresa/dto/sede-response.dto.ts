import { ApiProperty } from '@nestjs/swagger';
import { SedeRole, TipoSede } from '@prisma/client';

/**
 * DTO para la información de una sede
 */
export class SedeResponseDto {
  @ApiProperty({
    description: 'ID de la sede',
    example: 'clxxx123456789',
  })
  id: string;

  @ApiProperty({
    description: 'ID de la empresa',
    example: 'clxxx123456789',
  })
  empresaId: string;

  @ApiProperty({
    description: 'Código único de la sede',
    example: 'SEDE-001',
  })
  codigo: string;

  @ApiProperty({
    description: 'Nombre de la sede',
    example: 'Sede Principal',
  })
  nombre: string;

  @ApiProperty({
    description: 'Teléfono de la sede',
    example: '+51 999 888 777',
    required: false,
  })
  telefono?: string;

  @ApiProperty({
    description: 'Email de la sede',
    example: 'sede@empresa.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Tipo de sede',
    enum: TipoSede,
    example: TipoSede.OPERATIVA_COMPLETA,
  })
  tipoSede: TipoSede;

  @ApiProperty({
    description: 'Dirección de la sede',
    example: 'Av. Principal 123, Lima',
    required: false,
  })
  direccion?: string;

  @ApiProperty({
    description: 'Referencia de ubicación',
    example: 'Frente al parque',
    required: false,
  })
  referencia?: string;

  @ApiProperty({
    description: 'Distrito',
    example: 'San Isidro',
    required: false,
  })
  distrito?: string;

  @ApiProperty({
    description: 'Provincia',
    example: 'Lima',
    required: false,
  })
  provincia?: string;

  @ApiProperty({
    description: 'Departamento',
    example: 'Lima',
    required: false,
  })
  departamento?: string;

  @ApiProperty({
    description: 'País',
    example: 'PERU',
    required: false,
  })
  pais?: string;

  @ApiProperty({
    description: 'Coordenadas geográficas',
    required: false,
  })
  coordenadas?: any;

  @ApiProperty({
    description: 'Horario de atención',
    required: false,
  })
  horarioAtencion?: any;

  @ApiProperty({
    description: 'Configuración adicional',
    required: false,
  })
  configuracion?: any;

  @ApiProperty({
    description: 'Serie para facturas',
    example: 'F001',
  })
  serieFactura: string;

  @ApiProperty({
    description: 'Serie para boletas',
    example: 'B001',
  })
  serieBoleta: string;

  @ApiProperty({
    description: 'Serie para notas de crédito sobre Facturas (prefijo FC)',
    example: 'FC01',
  })
  serieNotaCredito: string;

  @ApiProperty({
    description: 'Serie para notas de crédito sobre Boletas (prefijo BC)',
    example: 'BC01',
  })
  serieNotaCreditoBoleta: string;

  @ApiProperty({
    description: 'Serie para notas de débito sobre Facturas (prefijo FD)',
    example: 'FD01',
  })
  serieNotaDebito: string;

  @ApiProperty({
    description: 'Serie para notas de débito sobre Boletas (prefijo BD)',
    example: 'BD01',
  })
  serieNotaDebitoBoleta: string;

  @ApiProperty({
    description: 'Serie para guías de remisión',
    example: 'GR01',
    required: false,
  })
  serieGuiaRemision?: string;

  @ApiProperty({
    description: 'Último número de factura emitida',
    example: 0,
  })
  ultimoNumeroFactura: number;

  @ApiProperty({
    description: 'Último número de boleta emitida',
    example: 0,
  })
  ultimoNumeroBoleta: number;

  @ApiProperty({
    description: 'Último número de NC sobre Factura emitida',
    example: 0,
  })
  ultimoNumeroNotaCredito: number;

  @ApiProperty({
    description: 'Último número de NC sobre Boleta emitida',
    example: 0,
  })
  ultimoNumeroNotaCreditoBoleta: number;

  @ApiProperty({
    description: 'Último número de ND sobre Factura emitida',
    example: 0,
  })
  ultimoNumeroNotaDebito: number;

  @ApiProperty({
    description: 'Último número de ND sobre Boleta emitida',
    example: 0,
  })
  ultimoNumeroNotaDebitoBoleta: number;

  @ApiProperty({
    description: 'Último número de guía de remisión emitida',
    example: 0,
  })
  ultimoNumeroGuiaRemision: number;

  @ApiProperty({
    description: 'Indica si es la sede principal',
    example: true,
  })
  esPrincipal: boolean;

  @ApiProperty({
    description: 'Indica si la sede está activa',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Fecha de eliminación (soft delete)',
    required: false,
  })
  deletedAt?: Date;

  @ApiProperty({
    description: 'Fecha de creación',
    example: '2024-01-01T00:00:00.000Z',
  })
  creadoEn: Date;

  @ApiProperty({
    description: 'Fecha de última actualización',
    example: '2024-01-01T00:00:00.000Z',
  })
  actualizadoEn: Date;

  @ApiProperty({
    description: 'Rol del usuario en esta sede (si tiene asignación específica)',
    enum: SedeRole,
    example: SedeRole.GERENTE_SEDE,
    required: false,
  })
  userRole?: SedeRole;

  @ApiProperty({
    description:
      'El usuario tiene asignación (UsuarioSedeRol) en esta sede. Los admin de empresa ' +
      'operan todas las sedes; el resto solo las asignadas. Úsalo en el front para ' +
      'mostrar el selector de "sede activa".',
    example: true,
  })
  asignada: boolean;

  @ApiProperty({
    description: 'El usuario puede abrir caja en esta sede (override de UsuarioSedeRol).',
    example: true,
  })
  puedeAbrirCaja: boolean;
}
