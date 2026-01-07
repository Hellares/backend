import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoSuscripcion, Rol, EmpresaUsuarioRol, RubroEmpresa } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService, AuditAction } from '../common/logger/audit-logger.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { CacheService } from '../redis/cache.service';
import { PermissionsService } from '../auth/services/permissions.service';
import {
  EmpresaContextResponseDto,
  EmpresaPermissionsDto,
  EmpresaStatisticsDto,
  SedeResponseDto,
  UserRoleInfoDto,
  EmpresaInfoDto,
  PersonalizacionEmpresaDto,
  PersonalizacionEmpresaResponseDto,
} from './dto';

export interface CreateEmpresaData {
  nombre: string;
  ruc?: string;
  rubro?: RubroEmpresa;
  descripcion?: string;
  telefono?: string;
  email?: string;
  web?: string;
  subdominio?: string;
  logo?: string;
  direccion?: string;
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
    private readonly catalogosService: CatalogosService,
    private readonly cache: CacheService,
    private readonly permissionsService: PermissionsService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(EmpresaService.name);
  }

  /**
   * Crear nueva empresa con suscripción básica y asignar rol de admin al usuario
   */
  async createEmpresa(data: CreateEmpresaData, userId: string): Promise<EmpresaResponse> {
    const { nombre, ruc, subdominio, rubro } = data;

    this.logger.info('Creating new empresa', { userId, nombre, ruc, subdominio, rubro });

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
        rubro: rubro, // Ahora es obligatorio desde el DTO
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
    const codigoSede = `SEDE-${String(1).padStart(3, '0')}`; // SEDE-001

    await this.prisma.sede.create({
      data: {
        empresaId: empresa.id,
        codigo: codigoSede,
        nombre: 'Sede Principal',
        telefono: data.telefono,
        email: data.email,
        direccion: data.direccion || 'Dirección por configurar',
        esPrincipal: true,
        tipoSede: 'OPERATIVA_COMPLETA',

        // Series de comprobantes por sede
        serieFactura: 'F001',
        serieBoleta: 'B001',
        serieNotaCredito: 'NC01',
        serieNotaDebito: 'ND01',
        serieGuiaRemision: 'GR01',

        // Contadores inicializados en 0
        ultimoNumeroFactura: 0,
        ultimoNumeroBoleta: 0,
        ultimoNumeroNotaCredito: 0,
        ultimoNumeroNotaDebito: 0,
        ultimoNumeroGuiaRemision: 0,
      },
    });

    // Activar catálogos según el rubro de la empresa
    try {
      const catalogosActivados = await this.catalogosService.activarCatalogosSegunRubro(
        empresa.id,
        empresa.rubro
      );
      this.logger.log(
        `Catálogos de ${empresa.rubro} activados: ${catalogosActivados.total} catálogos (${catalogosActivados.categorias.length} categorías, ${catalogosActivados.marcas.length} marcas)`
      );
    } catch (error) {
      this.logger.warn(`Error al activar catálogos de ${empresa.rubro}`, {
        error: error.message,
        empresaId: empresa.id
      });
      // No lanzar error, continuar con la creación de empresa
    }

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
   * Crear empresa con selección personalizada de catálogos
   * Permite al usuario especificar qué categorías y marcas activar
   */
  async createEmpresaConCatalogos(
    data: any,
    userId: string,
  ): Promise<EmpresaResponse> {
    const {
      categoriasMaestrasIds,
      marcasMaestrasIds,
      categoriasPersonalizadas,
      marcasPersonalizadas,
      ...empresaData
    } = data;

    this.logger.info('Creating empresa with custom catalogs', {
      userId,
      hasCustomCategories: !!categoriasMaestrasIds,
      hasCustomBrands: !!marcasMaestrasIds,
    });

    // Crear la empresa base (sin activación automática de catálogos)
    const empresa = await this.createEmpresaBase(empresaData, userId);

    // Activar catálogos según preferencias
    try {
      const usarRecomendados =
        !categoriasMaestrasIds &&
        !marcasMaestrasIds &&
        !categoriasPersonalizadas &&
        !marcasPersonalizadas;

      if (usarRecomendados) {
        // Si no se especificaron catálogos, usar los recomendados del rubro
        this.logger.log(
          `Activando catálogos recomendados para rubro: ${empresa.rubro}`,
        );
        const catalogosActivados = await this.catalogosService.activarCatalogosSegunRubro(
          empresa.id,
          empresa.rubro,
        );
        this.logger.log(
          `Catálogos activados: ${catalogosActivados.total} (${catalogosActivados.categorias.length} categorías, ${catalogosActivados.marcas.length} marcas)`,
        );
      } else {
        // Activar catálogos personalizados
        this.logger.log(
          `Activando catálogos personalizados para empresa ${empresa.id}`,
        );

        let categoriasCount = 0;
        let marcasCount = 0;

        // Activar categorías maestras seleccionadas
        if (categoriasMaestrasIds && categoriasMaestrasIds.length > 0) {
          for (const categoriaId of categoriasMaestrasIds) {
            try {
              await this.catalogosService.activarCategoriaParaEmpresa({
                empresaId: empresa.id,
                categoriaMaestraId: categoriaId,
              });
              categoriasCount++;
            } catch (error) {
              this.logger.warn(
                `Error activando categoría ${categoriaId}: ${error.message}`,
              );
            }
          }
        }

        // Activar marcas maestras seleccionadas
        if (marcasMaestrasIds && marcasMaestrasIds.length > 0) {
          for (const marcaId of marcasMaestrasIds) {
            try {
              await this.catalogosService.activarMarcaParaEmpresa({
                empresaId: empresa.id,
                marcaMaestraId: marcaId,
              });
              marcasCount++;
            } catch (error) {
              this.logger.warn(
                `Error activando marca ${marcaId}: ${error.message}`,
              );
            }
          }
        }

        // Crear categorías personalizadas
        if (categoriasPersonalizadas && categoriasPersonalizadas.length > 0) {
          for (const categoria of categoriasPersonalizadas) {
            try {
              await this.catalogosService.activarCategoriaParaEmpresa({
                empresaId: empresa.id,
                nombrePersonalizado: categoria.nombre,
                descripcionPersonalizada: categoria.descripcion,
              });
              categoriasCount++;
            } catch (error) {
              this.logger.warn(
                `Error creando categoría personalizada: ${error.message}`,
              );
            }
          }
        }

        // Crear marcas personalizadas
        if (marcasPersonalizadas && marcasPersonalizadas.length > 0) {
          for (const marca of marcasPersonalizadas) {
            try {
              await this.catalogosService.activarMarcaParaEmpresa({
                empresaId: empresa.id,
                nombrePersonalizado: marca.nombre,
                descripcionPersonalizada: marca.descripcion,
              });
              marcasCount++;
            } catch (error) {
              this.logger.warn(
                `Error creando marca personalizada: ${error.message}`,
              );
            }
          }
        }

        this.logger.log(
          `Catálogos personalizados activados: ${categoriasCount} categorías, ${marcasCount} marcas`,
        );
      }
    } catch (error) {
      this.logger.warn(`Error al activar catálogos: ${error.message}`);
      // No lanzar error, la empresa ya fue creada
    }

    return this.formatEmpresaResponse(empresa);
  }

  /**
   * Método base para crear empresa (sin activación automática de catálogos)
   * Reutilizable por createEmpresa y createEmpresaConCatalogos
   */
  private async createEmpresaBase(
    data: CreateEmpresaData,
    userId: string,
  ): Promise<any> {
    const { nombre, ruc, subdominio, rubro } = data;

    // Verificar si ya existe una empresa con el mismo RUC
    if (ruc) {
      const existingRuc = await this.prisma.empresa.findFirst({
        where: {
          ruc,
          deletedAt: null,
        },
      });
      if (existingRuc) {
        this.logger.warn('Empresa creation failed: RUC already exists', {
          ruc,
          userId,
        });
        throw new ConflictException('Ya existe una empresa con este RUC');
      }
    }

    // Verificar si ya existe una empresa con el mismo subdominio
    if (subdominio) {
      const existingSubdomain = await this.prisma.empresa.findFirst({
        where: {
          subdominio,
          deletedAt: null,
        },
      });
      if (existingSubdomain) {
        this.logger.warn(
          'Empresa creation failed: Subdomain already in use',
          { subdominio, userId },
        );
        throw new ConflictException('Este subdominio ya está en uso');
      }
    }

    // Obtener el plan básico (gratuito)
    const planBasico = await this.prisma.planSuscripcion.findFirst({
      where: {
        nombre: 'BÁSICO',
        isActive: true,
      },
    });

    if (!planBasico) {
      throw new BadRequestException(
        'No se encontró el plan básico. Por favor, contacte al administrador.',
      );
    }

    // Generar subdominio único si no se proporciona
    let subdominioFinal = subdominio;
    if (!subdominioFinal) {
      subdominioFinal = this.generateSubdominio(nombre);
      // Asegurar que el subdominio sea único
      let attempts = 0;
      while (
        await this.prisma.empresa.findFirst({
          where: { subdominio: subdominioFinal, deletedAt: null },
        })
      ) {
        subdominioFinal = this.generateSubdominio(nombre, ++attempts);
      }
    }

    // Generar fechas de suscripción (30 días de prueba gratuita)
    const ahora = new Date();
    const fechaFinPrueba = new Date(
      ahora.getTime() + 30 * 24 * 60 * 60 * 1000,
    ); // 30 días

    // Crear la empresa
    const empresa = await this.prisma.empresa.create({
      data: {
        nombre,
        ruc,
        rubro: rubro,
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
        porcentajeIGV: 18.0,
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
    const codigoSede = `SEDE-${String(1).padStart(3, '0')}`; // SEDE-001

    await this.prisma.sede.create({
      data: {
        empresaId: empresa.id,
        codigo: codigoSede,
        nombre: 'Sede Principal',
        telefono: data.telefono,
        email: data.email,
        direccion: data.direccion || 'Dirección por configurar',
        esPrincipal: true,
        tipoSede: 'OPERATIVA_COMPLETA',

        // Series de comprobantes por sede
        serieFactura: 'F001',
        serieBoleta: 'B001',
        serieNotaCredito: 'NC01',
        serieNotaDebito: 'ND01',
        serieGuiaRemision: 'GR01',

        // Contadores inicializados en 0
        ultimoNumeroFactura: 0,
        ultimoNumeroBoleta: 0,
        ultimoNumeroNotaCredito: 0,
        ultimoNumeroNotaDebito: 0,
        ultimoNumeroGuiaRemision: 0,
      },
    });

    this.logger.success('Empresa base created successfully', {
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

    return empresa;
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
        rubro: data.rubro as any,
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

  /**
   * Obtener contexto completo de la empresa
   * Incluye información de la empresa, roles del usuario, sedes, permisos y estadísticas
   */
  async getEmpresaContext(empresaId: string, userId: string): Promise<EmpresaContextResponseDto> {
    this.logger.info('Getting empresa context', { empresaId, userId });

    // 1. Verificar que el usuario tenga acceso a esta empresa y obtener sus roles
    const userRoles = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: {
        creadoEn: 'asc',
      },
    });

    if (!userRoles.length) {
      this.logger.warn('User does not have access to empresa', { empresaId, userId });
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    // 2. Obtener datos de la empresa
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: {
        planSuscripcion: true,
      },
    });

    if (!empresa || empresa.deletedAt) {
      this.logger.warn('Empresa not found or deleted', { empresaId });
      throw new NotFoundException('Empresa no encontrada');
    }

    // 3. Obtener sedes con roles del usuario
    const sedes = await this.prisma.sede.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null
      },
      include: {
        usuarios: {
          where: { usuarioId: userId },
        },
      },
      orderBy: [
        { esPrincipal: 'desc' },
        { nombre: 'asc' },
      ],
    });

    // 4. Calcular estadísticas
    const statistics = await this.calculateStatistics(empresaId);

    // 5. Calcular permisos basados en roles
    const permissions = this.calculatePermissions(userRoles);

    // 6. Formatear respuesta
    const empresaInfo: EmpresaInfoDto = {
      id: empresa.id,
      nombre: empresa.nombre,
      ruc: empresa.ruc,
      subdominio: empresa.subdominio,
      logo: empresa.logo,
      email: empresa.email,
      telefono: empresa.telefono,
      descripcion: empresa.descripcion,
      web: empresa.web,
      planSuscripcionId: empresa.planSuscripcionId,
      estadoSuscripcion: empresa.estadoSuscripcion,
      usuariosActuales: empresa.usuariosActuales,
      fechaInicioSuscripcion: empresa.fechaInicioSuscripcion,
      fechaVencimiento: empresa.fechaVencimiento,
      planSuscripcion: empresa.planSuscripcion ? {
        id: empresa.planSuscripcion.id,
        nombre: empresa.planSuscripcion.nombre,
        descripcion: empresa.planSuscripcion.descripcion,
        precio: Number(empresa.planSuscripcion.precio),
        periodo: empresa.planSuscripcion.periodo,
      } : undefined,
    };

    const userRolesInfo: UserRoleInfoDto[] = userRoles.map(ur => ({
      id: ur.id,
      rol: ur.rol,
      isActive: ur.isActive,
      estado: ur.estado,
      fechaAprobacion: ur.fechaAprobacion,
    }));

    const sedesInfo: SedeResponseDto[] = sedes.map(sede => ({
      id: sede.id,
      nombre: sede.nombre,
      telefono: sede.telefono,
      email: sede.email,
      direccion: sede.direccion,
      esPrincipal: sede.esPrincipal,
      isActive: sede.isActive,
      userRole: sede.usuarios.length > 0 ? sede.usuarios[0].rol : undefined,
    }));

    this.logger.success('Empresa context retrieved successfully', {
      empresaId,
      userId,
      rolesCount: userRoles.length,
      sedesCount: sedes.length,
    });

    return {
      empresa: empresaInfo,
      userRoles: userRolesInfo,
      sedes: sedesInfo,
      permissions,
      statistics,
    };
  }

  /**
   * Calcular permisos del usuario basado en sus roles en la empresa
   * Usa el PermissionsService centralizado
   */
  private calculatePermissions(userRoles: EmpresaUsuarioRol[]): EmpresaPermissionsDto {
    const roles = userRoles.map(r => r.rol);
    return this.permissionsService.calculatePermissions(roles);
  }

  /**
   * //!Calcular estadísticas de la empresa (con cache de 30 minutos)
   */
  private async calculateStatistics(empresaId: string): Promise<EmpresaStatisticsDto> {
    const cacheKey = this.cache.getEmpresaStatsKey(empresaId);

    return this.cache.getOrSet(
      cacheKey,
      async () => {
        this.logger.debug('Calculating statistics from database', { empresaId });

        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const [
          totalProductos,
          totalServicios,
          totalUsuarios,
          totalSedes,
          ordenesPendientes,
          comprobantesMes,
          comprobantesConTotal,
        ] = await Promise.all([
      // Total de productos activos
      this.prisma.producto.count({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
      }),

      // Total de servicios activos
      this.prisma.servicio.count({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
      }),

      // Total de usuarios activos
      this.prisma.empresaUsuarioRol.count({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
      }),

      // Total de sedes activas
      this.prisma.sede.count({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
      }),

      // Órdenes de servicio pendientes
      this.prisma.ordenServicio.count({
        where: {
          empresaId,
          estado: {
            in: ['RECIBIDO', 'EN_DIAGNOSTICO', 'EN_REPARACION', 'ESPERANDO_APROBACION', 'PENDIENTE_PIEZAS'],
          },
        },
      }),

      // Comprobantes emitidos este mes
      this.prisma.comprobanteElectronico.count({
        where: {
          empresaId,
          fechaEmision: {
            gte: firstDayOfMonth,
            lte: lastDayOfMonth,
          },
          anulado: false,
        },
      }),

      // Comprobantes con totales para calcular ingresos
      this.prisma.comprobanteElectronico.findMany({
        where: {
          empresaId,
          fechaEmision: {
            gte: firstDayOfMonth,
            lte: lastDayOfMonth,
          },
          anulado: false,
          estado: {
            in: ['REGISTRADO', 'ACEPTADO'],
          },
        },
        select: {
          total: true,
        },
      }),
    ]);

        // Calcular ingresos totales del mes
        const ingresosMes = comprobantesConTotal.reduce(
          (sum, comprobante) => sum + Number(comprobante.total),
          0,
        );

        return {
          totalProductos,
          totalServicios,
          totalUsuarios,
          totalSedes,
          ordenesPendientes,
          comprobantesMes,
          ingresosMes: Math.round(ingresosMes * 100) / 100, // Redondear a 2 decimales
        };
      },
      1800, //! Cache por 30 minutos (se invalida automáticamente al modificar datos)
    );
  }

  /**
   * Obtener personalización de la empresa
   */
  async getPersonalizacion(empresaId: string, userId: string): Promise<PersonalizacionEmpresaResponseDto> {
    this.logger.info('Getting empresa personalization', { empresaId, userId });

    // Verificar acceso del usuario a la empresa
    const hasAccess = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!hasAccess) {
      this.logger.warn('User does not have access to empresa', { empresaId, userId });
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    // Buscar personalización existente
    let personalizacion = await this.prisma.personalizacionEmpresa.findFirst({
      where: { empresaId },
    });

    // Si no existe, crear una con valores por defecto
    if (!personalizacion) {
      this.logger.info('Creating default personalization', { empresaId });
      personalizacion = await this.prisma.personalizacionEmpresa.create({
        data: {
          empresaId,
          mostrarPrecios: true,
          mostrarContacto: true,
          mostrarRedesSociales: false,
          permitirRegistro: true,
          productosDestacados: [],
          serviciosDestacados: [],
        },
      });
    }

    this.logger.success('Personalization retrieved successfully', { empresaId });
    return personalizacion as PersonalizacionEmpresaResponseDto;
  }

  /**
   * Actualizar personalización de la empresa
   */
  async updatePersonalizacion(
    empresaId: string,
    userId: string,
    data: PersonalizacionEmpresaDto,
  ): Promise<PersonalizacionEmpresaResponseDto> {
    this.logger.info('Updating empresa personalization', { empresaId, userId });

    // Verificar que el usuario sea administrador de la empresa
    const userRole = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: {
          in: [Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN],
        },
      },
    });

    if (!userRole) {
      this.logger.warn('User does not have admin permissions', { empresaId, userId });
      throw new ForbiddenException('No tienes permisos para modificar la personalización');
    }

    // Verificar si ya existe personalización
    const existingPersonalizacion = await this.prisma.personalizacionEmpresa.findFirst({
      where: { empresaId },
    });

    let personalizacion;

    if (existingPersonalizacion) {
      // Actualizar personalización existente
      personalizacion = await this.prisma.personalizacionEmpresa.update({
        where: { id: existingPersonalizacion.id },
        data: {
          webConfig: data.webConfig,
          bannerPrincipalUrl: data.bannerPrincipalUrl,
          bannerPrincipalTexto: data.bannerPrincipalTexto,
          bannerColor: data.bannerColor,
          colorPrimario: data.colorPrimario,
          colorSecundario: data.colorSecundario,
          colorAcento: data.colorAcento,
          mostrarPrecios: data.mostrarPrecios,
          productosDestacados: data.productosDestacados,
          serviciosDestacados: data.serviciosDestacados,
          mostrarContacto: data.mostrarContacto,
          mostrarRedesSociales: data.mostrarRedesSociales,
          permitirRegistro: data.permitirRegistro,
          appConfig: data.appConfig,
          appSplashScreenUrl: data.appSplashScreenUrl,
          appColorTema: data.appColorTema,
          dominioPersonalizado: data.dominioPersonalizado,
        },
      });
    } else {
      // Crear nueva personalización
      personalizacion = await this.prisma.personalizacionEmpresa.create({
        data: {
          empresaId,
          webConfig: data.webConfig,
          bannerPrincipalUrl: data.bannerPrincipalUrl,
          bannerPrincipalTexto: data.bannerPrincipalTexto,
          bannerColor: data.bannerColor,
          colorPrimario: data.colorPrimario,
          colorSecundario: data.colorSecundario,
          colorAcento: data.colorAcento,
          mostrarPrecios: data.mostrarPrecios ?? true,
          productosDestacados: data.productosDestacados ?? [],
          serviciosDestacados: data.serviciosDestacados ?? [],
          mostrarContacto: data.mostrarContacto ?? true,
          mostrarRedesSociales: data.mostrarRedesSociales ?? false,
          permitirRegistro: data.permitirRegistro ?? true,
          appConfig: data.appConfig,
          appSplashScreenUrl: data.appSplashScreenUrl,
          appColorTema: data.appColorTema,
          dominioPersonalizado: data.dominioPersonalizado,
        },
      });
    }

    this.logger.success('Personalization updated successfully', { empresaId });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_UPDATED,
      actor: { userId },
      target: {
        type: 'PersonalizacionEmpresa',
        id: personalizacion.id,
        name: `Personalización de empresa ${empresaId}`,
      },
      metadata: data,
      success: true,
    });

    return personalizacion as PersonalizacionEmpresaResponseDto;
  }
}