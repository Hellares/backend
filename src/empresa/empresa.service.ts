import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoSuscripcion, Rol } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService, AuditAction } from '../common/logger/audit-logger.service';

export interface CreateEmpresaData {
  nombre: string;
  ruc?: string;
  descripcion?: string;
  telefono?: string;
  email?: string;
  web?: string;
  subdominio?: string;
  logo?: string;
}

export interface EmpresaResponse {
  id: string;
  nombre: string;
  ruc?: string;
  subdominio?: string;
  logo?: string;
  email?: string;
  telefono?: string;
  web?: string;
  descripcion?: string;
  isActive: boolean;
  roles: Rol[]; // Roles del usuario en esta empresa (puede tener múltiples)
  planSuscripcion?: {
    id: string;
    nombre: string;
    descripcion: string;
    precio: number;
    periodo: string;
  };
  estadoSuscripcion: EstadoSuscripcion;
  fechaInicioSuscripcion?: Date;
  fechaVencimiento?: Date;
  usuariosActuales: number;
  creadoEn: Date;
  actualizadoEn: Date;
}

@Injectable()
export class EmpresaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly auditLogger: AuditLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(EmpresaService.name);
  }

  /**
   * Crear nueva empresa con suscripción básica y asignar rol de admin al usuario
   */
  async createEmpresa(data: CreateEmpresaData, userId: string): Promise<EmpresaResponse> {
    const { nombre, ruc, subdominio } = data;

    this.logger.info('Creating new empresa', { userId, nombre, ruc, subdominio });

    // Verificar si ya existe una empresa con el mismo RUC
    if (ruc) {
      const existingRuc = await this.prisma.empresa.findFirst({
        where: {
          ruc,
          deletedAt: null
        }
      });
      if (existingRuc) {
        this.logger.warn('Empresa creation failed: RUC already exists', { ruc, userId });
        throw new ConflictException('Ya existe una empresa con este RUC');
      }
    }

    // Verificar si ya existe una empresa con el mismo subdominio
    if (subdominio) {
      const existingSubdomain = await this.prisma.empresa.findFirst({
        where: {
          subdominio,
          deletedAt: null
        }
      });
      if (existingSubdomain) {
        this.logger.warn('Empresa creation failed: Subdomain already in use', { subdominio, userId });
        throw new ConflictException('Este subdominio ya está en uso');
      }
    }

    // Obtener el plan básico (gratuito)
    const planBasico = await this.prisma.planSuscripcion.findFirst({
      where: {
        nombre: 'BÁSICO',
        isActive: true
      }
    });

    if (!planBasico) {
      throw new BadRequestException('No se encontró el plan básico. Por favor, contacte al administrador.');
    }

    // Generar subdominio único si no se proporciona
    let subdominioFinal = subdominio;
    if (!subdominioFinal) {
      subdominioFinal = this.generateSubdominio(nombre);
      // Asegurar que el subdominio sea único
      let attempts = 0;
      while (await this.prisma.empresa.findFirst({
        where: { subdominio: subdominioFinal, deletedAt: null }
      })) {
        subdominioFinal = this.generateSubdominio(nombre, ++attempts);
      }
    }

    // Generar fechas de suscripción (30 días de prueba gratuita)
    const ahora = new Date();
    const fechaFinPrueba = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días

    // Crear la empresa
    const empresa = await this.prisma.empresa.create({
      data: {
        nombre,
        ruc,
        subdominio: subdominioFinal,
        descripcion: data.descripcion,
        telefono: data.telefono,
        email: data.email,
        web: data.web,
        logo: data.logo,
        planSuscripcionId: planBasico.id,
        fechaInicioSuscripcion: ahora,
        fechaVencimiento: fechaFinPrueba,
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
        usuariosActuales: 1,
      },
      include: {
        planSuscripcion: true,
      },
    });

    // Crear configuración inicial de códigos
    await this.prisma.configuracionCodigos.create({
      data: {
        empresaId: empresa.id,
        productoCodigo: 'PROD',
        productoSeparador: '-',
        productoLongitud: 6,
        productoIncluirSede: false,
        servicioCodigo: 'SERV',
        servicioSeparador: '-',
        servicioLongitud: 6,
        servicioIncluirSede: false,
        facturaCodigo: 'F001',
        boletaCodigo: 'B001',
        notaCreditoCodigo: 'NC01',
        notaDebitoCodigo: 'ND01',
        documentoSeparador: '-',
        documentoLongitud: 8,
        ultimoProducto: 0,
        ultimoServicio: 0,
        ultimoFactura: 0,
        ultimaBoleta: 0,
        ultimaNotaCredito: 0,
        ultimaNotaDebito: 0,
      },
    });

    // Crear configuración inicial de facturación
    await this.prisma.configuracionFacturacion.create({
      data: {
        empresaId: empresa.id,
        serieFactura: 'F001',
        serieBoleta: 'B001',
        serieNotaCredito: 'NC01',
        serieNotaDebito: 'ND01',
        entorno: 'BETA',
        textoPiePagina: 'Gracias por su compra',
        incluirIGV: true,
        incluirDetalles: true,
        formatoPapel: 'A4',
        porcentajeIGV: 18.00,
      },
    });

    // Asignar al usuario como administrador de la empresa
    await this.prisma.empresaUsuarioRol.create({
      data: {
        usuarioId: userId,
        empresaId: empresa.id,
        rol: Rol.EMPRESA_ADMIN,
        estado: 'ACTIVO' as any,
        creadoPor: userId,
        registradoPor: userId,
        fechaAprobacion: ahora,
        aprobadoPor: userId,
      },
    });

    // Crear sede principal por defecto
    await this.prisma.sede.create({
      data: {
        empresaId: empresa.id,
        nombre: 'Sede Principal',
        telefono: data.telefono,
        email: data.email,
        direccion: 'Dirección por configurar',
        esPrincipal: true,
      },
    });

    this.logger.success('Empresa created successfully', {
      empresaId: empresa.id,
      nombre: empresa.nombre,
      userId,
    });

    // Auditoría de creación de empresa
    this.auditLogger.log({
      action: AuditAction.TENANT_CREATED,
      actor: { userId },
      target: {
        type: 'Empresa',
        id: empresa.id,
        name: empresa.nombre,
      },
      metadata: {
        ruc,
        subdominio: empresa.subdominio,
        planSuscripcionId: empresa.planSuscripcionId,
      },
      success: true,
    });

    return this.formatEmpresaResponse(empresa);
  }

  /**
   * Obtener empresas del usuario con todos sus roles
   */
  async getEmpresasByUsuario(userId: string): Promise<EmpresaResponse[]> {
    const empresasUsuario = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        usuarioId: userId,
        isActive: true,
        empresa: {
          deletedAt: null,
        },
      },
      include: {
        empresa: {
          include: {
            planSuscripcion: true,
          },
        },
      },
      orderBy: {
        creadoEn: 'desc',
      },
    });

    // Agrupar roles por empresa
    const empresasMap = new Map<string, { empresa: any; roles: Rol[] }>();

    for (const eu of empresasUsuario) {
      if (!empresasMap.has(eu.empresaId)) {
        empresasMap.set(eu.empresaId, {
          empresa: eu.empresa,
          roles: [eu.rol],
        });
      } else {
        empresasMap.get(eu.empresaId)!.roles.push(eu.rol);
      }
    }

    // Convertir el mapa a array de respuestas
    return Array.from(empresasMap.values()).map(({ empresa, roles }) =>
      this.formatEmpresaResponse(empresa, roles)
    );
  }

  /**
   * Obtener empresa por ID (verificar acceso del usuario)
   */
  async getEmpresaById(empresaId: string, userId: string): Promise<EmpresaResponse> {
    // Verificar que el usuario tenga acceso a la empresa
    const accesoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: userId,
        empresaId: empresaId,
        isActive: true,
        empresa: {
          deletedAt: null,
        },
      },
      include: {
        empresa: {
          include: {
            planSuscripcion: true,
          },
        },
      },
    });

    if (!accesoEmpresa) {
      throw new NotFoundException('Empresa no encontrada o no tienes acceso a ella');
    }

    return this.formatEmpresaResponse(accesoEmpresa.empresa);
  }

  /**
   * Actualizar información de la empresa
   */
  async updateEmpresa(empresaId: string, userId: string, data: Partial<CreateEmpresaData>): Promise<EmpresaResponse> {
    // Verificar acceso y permisos
    const accesoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: userId,
        empresaId: empresaId,
        isActive: true,
        empresa: {
          deletedAt: null,
        },
        rol: {
          in: [Rol.EMPRESA_ADMIN, Rol.SUPER_ADMIN],
        },
      },
    });

    if (!accesoEmpresa) {
      throw new NotFoundException('Empresa no encontrada o no tienes permisos para editarla');
    }

    // Verificar unicidad de RUC y subdominio si se están actualizando
    if (data.ruc) {
      const existingRuc = await this.prisma.empresa.findFirst({
        where: {
          ruc: data.ruc,
          id: { not: empresaId },
          deletedAt: null
        }
      });
      if (existingRuc) {
        throw new ConflictException('Ya existe otra empresa con este RUC');
      }
    }

    if (data.subdominio) {
      const existingSubdomain = await this.prisma.empresa.findFirst({
        where: {
          subdominio: data.subdominio,
          id: { not: empresaId },
          deletedAt: null
        }
      });
      if (existingSubdomain) {
        throw new ConflictException('Este subdominio ya está en uso por otra empresa');
      }
    }

    const empresaActualizada = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        nombre: data.nombre,
        ruc: data.ruc,
        subdominio: data.subdominio,
        descripcion: data.descripcion,
        telefono: data.telefono,
        email: data.email,
        web: data.web,
        logo: data.logo,
      },
      include: {
        planSuscripcion: true,
      },
    });

    return this.formatEmpresaResponse(empresaActualizada);
  }

  /**
   * Generar subdominio único a partir del nombre
   */
  private generateSubdominio(nombre: string, suffix: number = 0): string {
    const base = nombre
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 20);

    return suffix > 0 ? `${base}-${suffix}` : base;
  }

  /**
   * Formatear respuesta de empresa
   */
  private formatEmpresaResponse(empresa: any, roles: Rol[] = []): EmpresaResponse {
    return {
      id: empresa.id,
      nombre: empresa.nombre,
      ruc: empresa.ruc,
      subdominio: empresa.subdominio,
      logo: empresa.logo,
      email: empresa.email,
      telefono: empresa.telefono,
      web: empresa.web,
      descripcion: empresa.descripcion,
      isActive: empresa.isActive,
      roles: roles, // Incluir todos los roles del usuario en esta empresa
      planSuscripcion: empresa.planSuscripcion ? {
        id: empresa.planSuscripcion.id,
        nombre: empresa.planSuscripcion.nombre,
        descripcion: empresa.planSuscripcion.descripcion,
        precio: Number(empresa.planSuscripcion.precio),
        periodo: empresa.planSuscripcion.periodo,
      } : undefined,
      estadoSuscripcion: empresa.estadoSuscripcion,
      fechaInicioSuscripcion: empresa.fechaInicioSuscripcion,
      fechaVencimiento: empresa.fechaVencimiento,
      usuariosActuales: empresa.usuariosActuales,
      creadoEn: empresa.creadoEn,
      actualizadoEn: empresa.actualizadoEn,
    };
  }

  /**
   * Obtener lista de planes de suscripción disponibles
   */
  async getPlanesDisponibles() {
    return this.prisma.planSuscripcion.findMany({
      where: { isActive: true },
      orderBy: { precio: 'asc' },
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        precio: true,
        periodo: true,
        limiteProductos: true,
        limiteServicios: true,
        limiteUsuarios: true,
        limiteSedes: true,
        tienePersonalizacion: true,
        tieneDominioPropio: true,
        tieneApi: true,
        tieneReportesAvanzados: true,
        caracteristicas: true,
      },
    });
  }

  /**
   * Cambiar plan de suscripción
   */
  async cambiarPlan(empresaId: string, userId: string, planId: string): Promise<EmpresaResponse> {
    // Verificar que el usuario sea administrador de la empresa
    const accesoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: userId,
        empresaId: empresaId,
        isActive: true,
        empresa: {
          deletedAt: null,
        },
        rol: {
          in: [Rol.EMPRESA_ADMIN, Rol.SUPER_ADMIN],
        },
      },
    });

    if (!accesoEmpresa) {
      throw new NotFoundException('Empresa no encontrada o no tienes permisos para cambiar el plan');
    }

    // Verificar que el plan exista y esté activo
    const nuevoPlan = await this.prisma.planSuscripcion.findFirst({
      where: {
        id: planId,
        isActive: true
      },
    });

    if (!nuevoPlan) {
      throw new NotFoundException('Plan de suscripción no encontrado o no está disponible');
    }

    // Actualizar el plan de la empresa
    const empresaActualizada = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        planSuscripcionId: planId,
        fechaInicioSuscripcion: new Date(),
        // Mantener la misma fecha de vencimiento o calcular nueva según el plan
      },
      include: {
        planSuscripcion: true,
      },
    });

    return this.formatEmpresaResponse(empresaActualizada);
  }
}