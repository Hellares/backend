import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService, AuditAction } from '../common/logger/audit-logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CreateProveedorDto, UpdateProveedorDto, EvaluarProveedorDto } from './dto';

@Injectable()
export class ProveedorService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly auditLogger: AuditLoggerService,
    private readonly configuracionCodigosService: ConfiguracionCodigosService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProveedorService.name);
  }

  /**
   * Crear nuevo proveedor
   */
  async create(data: CreateProveedorDto) {
    // Validar campos requeridos asignados por el controlador
    if (!data.empresaId || !data.creadoPor) {
      throw new BadRequestException(
        'empresaId y creadoPor son requeridos (asignados automáticamente)',
      );
    }

    this.logger.info('Creating new proveedor', {
      empresaId: data.empresaId,
      nombre: data.nombre,
      numeroDocumento: data.numeroDocumento,
    });

    // Verificar que no exista un proveedor con el mismo número de documento en la empresa
    const existente = await this.prisma.proveedor.findUnique({
      where: {
        empresaId_numeroDocumento: {
          empresaId: data.empresaId,
          numeroDocumento: data.numeroDocumento,
        },
      },
    });

    if (existente) {
      throw new ConflictException(
        `Ya existe un proveedor con el documento ${data.numeroDocumento}`,
      );
    }

    // Generar código automático
    const codigo = (
      await this.configuracionCodigosService.generarCodigoProveedor(data.empresaId)
    ).codigoProveedor;

    // Crear proveedor con contactos y bancos
    const proveedor = await this.prisma.proveedor.create({
      data: {
        empresaId: data.empresaId,
        codigo,
        nombre: data.nombre,
        nombreComercial: data.nombreComercial,
        tipoDocumento: data.tipoDocumento,
        numeroDocumento: data.numeroDocumento,
        email: data.email,
        telefono: data.telefono,
        telefonoAlternativo: data.telefonoAlternativo,
        sitioWeb: data.sitioWeb,
        direccion: data.direccion,
        ciudad: data.ciudad,
        provincia: data.provincia,
        pais: data.pais || 'PE',
        codigoPostal: data.codigoPostal,
        terminosPago: data.terminosPago,
        diasCredito: data.diasCredito,
        limiteCredito: data.limiteCredito,
        descuentoPreferencial: data.descuentoPreferencial,
        contactoPrincipal: data.contactoPrincipal,
        cargoContacto: data.cargoContacto,
        notas: data.notas,
        calificacion: data.calificacion,
        isActive: data.isActive !== undefined ? data.isActive : true,
        motivoInactivo: data.motivoInactivo,
        creadoPor: data.creadoPor,
        contactos: data.contactos
          ? {
              create: data.contactos.map((c) => ({
                nombre: c.nombre,
                cargo: c.cargo,
                email: c.email,
                telefono: c.telefono,
                telefonoMovil: c.telefonoMovil,
                esPrincipal: c.esPrincipal || false,
              })),
            }
          : undefined,
        bancos: data.bancos
          ? {
              create: data.bancos.map((b) => ({
                nombreBanco: b.nombreBanco,
                tipoCuenta: b.tipoCuenta,
                numeroCuenta: b.numeroCuenta,
                cci: b.cci,
                swift: b.swift,
                moneda: b.moneda || 'PEN',
                esPrincipal: b.esPrincipal || false,
              })),
            }
          : undefined,
      },
      include: {
        contactos: true,
        bancos: true,
        evaluaciones: {
          orderBy: { fechaEvaluacion: 'desc' },
          take: 5,
        },
      },
    });

    this.logger.success('Proveedor created successfully', {
      proveedorId: proveedor.id,
      codigo: proveedor.codigo,
    });

    // Auditoría
    await this.auditLogger.log({
      action: AuditAction.TENANT_CREATED,
      actor: { userId: data.creadoPor },
      target: {
        type: 'Proveedor',
        id: proveedor.id,
        name: proveedor.nombre,
      },
      metadata: {
        empresaId: data.empresaId,
        codigo: proveedor.codigo,
        numeroDocumento: proveedor.numeroDocumento,
      },
      success: true,
    });

    return proveedor;
  }

  /**
   * Obtener todos los proveedores de una empresa
   */
  async findAll(empresaId: string, includeInactive = false) {
    this.logger.info('Fetching proveedores', { empresaId, includeInactive });

    return this.prisma.proveedor.findMany({
      where: {
        empresaId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        contactos: true,
        bancos: true,
        evaluaciones: {
          orderBy: { fechaEvaluacion: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            productosPreferenciales: true,
          },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Obtener un proveedor por ID
   */
  async findOne(id: string, empresaId: string) {
    this.logger.info('Fetching proveedor by ID', { id, empresaId });

    const proveedor = await this.prisma.proveedor.findFirst({
      where: {
        id,
        empresaId,
      },
      include: {
        contactos: true,
        bancos: true,
        evaluaciones: {
          orderBy: { fechaEvaluacion: 'desc' },
        },
        productosPreferenciales: {
          include: {
            producto: {
              select: {
                id: true,
                nombre: true,
                codigoEmpresa: true,
              },
            },
            variante: {
              select: {
                id: true,
                nombre: true,
                sku: true,
              },
            },
          },
        },
      },
    });

    if (!proveedor) {
      throw new NotFoundException(`Proveedor with ID ${id} not found`);
    }

    return proveedor;
  }

  /**
   * Actualizar proveedor
   */
  async update(id: string, empresaId: string, data: UpdateProveedorDto) {
    this.logger.info('Updating proveedor', { id, empresaId });

    // Verificar que el proveedor existe
    const proveedor = await this.findOne(id, empresaId);

    // Si se está actualizando el número de documento, verificar que no exista otro con ese número
    if (data.numeroDocumento && data.numeroDocumento !== proveedor.numeroDocumento) {
      const existente = await this.prisma.proveedor.findUnique({
        where: {
          empresaId_numeroDocumento: {
            empresaId,
            numeroDocumento: data.numeroDocumento,
          },
        },
      });

      if (existente) {
        throw new ConflictException(
          `Ya existe un proveedor con el documento ${data.numeroDocumento}`,
        );
      }
    }

    const updated = await this.prisma.proveedor.update({
      where: { id },
      data: {
        nombre: data.nombre,
        nombreComercial: data.nombreComercial,
        tipoDocumento: data.tipoDocumento,
        numeroDocumento: data.numeroDocumento,
        email: data.email,
        telefono: data.telefono,
        telefonoAlternativo: data.telefonoAlternativo,
        sitioWeb: data.sitioWeb,
        direccion: data.direccion,
        ciudad: data.ciudad,
        provincia: data.provincia,
        pais: data.pais,
        codigoPostal: data.codigoPostal,
        terminosPago: data.terminosPago,
        diasCredito: data.diasCredito,
        limiteCredito: data.limiteCredito,
        descuentoPreferencial: data.descuentoPreferencial,
        contactoPrincipal: data.contactoPrincipal,
        cargoContacto: data.cargoContacto,
        notas: data.notas,
        calificacion: data.calificacion,
        isActive: data.isActive,
        motivoInactivo: data.motivoInactivo,
        actualizadoPor: data.actualizadoPor,
      },
      include: {
        contactos: true,
        bancos: true,
        evaluaciones: {
          orderBy: { fechaEvaluacion: 'desc' },
          take: 5,
        },
      },
    });

    this.logger.success('Proveedor updated successfully', { id });

    // Auditoría
    await this.auditLogger.log({
      action: AuditAction.TENANT_UPDATED,
      actor: { userId: data.actualizadoPor },
      target: {
        type: 'Proveedor',
        id: id,
        name: updated.nombre,
      },
      metadata: {
        empresaId,
        changes: data,
      },
      success: true,
    });

    return updated;
  }

  /**
   * Eliminar (soft delete) un proveedor
   */
  async remove(id: string, empresaId: string, userId: string, motivo?: string) {
    this.logger.info('Removing proveedor', { id, empresaId });

    // Verificar que el proveedor existe
    await this.findOne(id, empresaId);

    const updated = await this.prisma.proveedor.update({
      where: { id },
      data: {
        isActive: false,
        motivoInactivo: motivo || 'Eliminado por el usuario',
        actualizadoPor: userId,
      },
    });

    this.logger.success('Proveedor removed successfully', { id });

    // Auditoría
    await this.auditLogger.log({
      action: AuditAction.TENANT_DELETED,
      actor: { userId },
      target: {
        type: 'Proveedor',
        id: id,
        name: updated.nombre,
      },
      metadata: {
        empresaId,
        motivo,
      },
      success: true,
    });

    return updated;
  }

  /**
   * Evaluar un proveedor
   */
  async evaluar(data: EvaluarProveedorDto) {
    this.logger.info('Evaluating proveedor', {
      proveedorId: data.proveedorId,
      evaluadoPor: data.evaluadoPor,
    });

    // Verificar que el proveedor existe
    await this.findOne(data.proveedorId, data.empresaId);

    // Calcular calificación general (promedio)
    const calificacionGeneral =
      (data.calidadProductos +
        data.cumplimientoPlazos +
        data.atencionServicio +
        data.preciosCompetitivos) /
      4;

    // Crear evaluación
    const evaluacion = await this.prisma.proveedorEvaluacion.create({
      data: {
        proveedorId: data.proveedorId,
        empresaId: data.empresaId,
        calidadProductos: data.calidadProductos,
        cumplimientoPlazos: data.cumplimientoPlazos,
        atencionServicio: data.atencionServicio,
        preciosCompetitivos: data.preciosCompetitivos,
        calificacionGeneral,
        comentarios: data.comentarios,
        evaluadoPor: data.evaluadoPor,
      },
    });

    // Actualizar calificación del proveedor (promedio de todas las evaluaciones)
    const todasEvaluaciones = await this.prisma.proveedorEvaluacion.findMany({
      where: { proveedorId: data.proveedorId },
    });

    const promedioTotal =
      todasEvaluaciones.reduce((sum, e) => sum + Number(e.calificacionGeneral), 0) /
      todasEvaluaciones.length;

    await this.prisma.proveedor.update({
      where: { id: data.proveedorId },
      data: { calificacion: Math.round(promedioTotal) },
    });

    this.logger.success('Proveedor evaluated successfully', {
      proveedorId: data.proveedorId,
      calificacionGeneral,
    });

    // Auditoría
    await this.auditLogger.log({
      action: AuditAction.SETTINGS_CHANGED,
      actor: { userId: data.evaluadoPor },
      target: {
        type: 'ProveedorEvaluacion',
        id: evaluacion.id,
      },
      metadata: {
        empresaId: data.empresaId,
        proveedorId: data.proveedorId,
        calificacionGeneral,
      },
      success: true,
    });

    return evaluacion;
  }

  /**
   * Obtener evaluaciones de un proveedor
   */
  async getEvaluaciones(proveedorId: string, empresaId: string) {
    this.logger.info('Fetching proveedor evaluaciones', { proveedorId, empresaId });

    await this.findOne(proveedorId, empresaId);

    return this.prisma.proveedorEvaluacion.findMany({
      where: {
        proveedorId,
        empresaId,
      },
      orderBy: { fechaEvaluacion: 'desc' },
    });
  }
}
