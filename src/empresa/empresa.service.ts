import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoSuscripcion, PeriodoSuscripcion, Rol, EmpresaUsuarioRol, RubroEmpresa } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService, AuditAction } from '../common/logger/audit-logger.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { CacheService } from '../redis/cache.service';
import { PermissionsService } from '../auth/services/permissions.service';
import { ConfiguracionDocumentosService } from '../configuracion-documentos/configuracion-documentos.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import {
  EmpresaContextResponseDto,
  EmpresaPermissionsDto,
  EmpresaStatisticsDto,
  SedeResponseDto,
  UserRoleInfoDto,
  EmpresaInfoDto,
  PersonalizacionEmpresaDto,
  PersonalizacionEmpresaResponseDto,
  ConfiguracionEmpresaDto,
  ConfiguracionEmpresaResponseDto,
} from './dto';

export interface CreateEmpresaData {
  nombre: string;
  ruc: string;
  razonSocial: string;
  condicionContribuyente: string;
  rubro?: RubroEmpresa;
  descripcion?: string;
  telefono?: string;
  email?: string;
  web?: string;
  subdominio?: string;
  logo?: string;
  // Datos SUNAT
  estadoContribuyente?: string;
  tipoContribuyente?: string;
  direccionFiscal?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  ubigeo?: string;
  // Tercerización B2B
  aceptaTercerizacion?: boolean;
  descripcionTercerizacion?: string;
  tiposServicioTercerizacion?: string[];
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
  // Tercerización B2B
  aceptaTercerizacion: boolean;
  descripcionTercerizacion?: string | null;
  tiposServicioTercerizacion?: string[] | null;
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
    private readonly configuracionDocumentosService: ConfiguracionDocumentosService,
    private readonly planLimitsService: PlanLimitsService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(EmpresaService.name);
  }

  /**
   * Crear nueva empresa con suscripción básica y asignar rol de admin al usuario
   * Usa createEmpresaBase + activación automática de catálogos por rubro
   */
  async createEmpresa(data: CreateEmpresaData, userId: string): Promise<EmpresaResponse> {
    this.logger.info('Creating new empresa', {
      userId,
      nombre: data.nombre,
      ruc: data.ruc,
      subdominio: data.subdominio,
      rubro: data.rubro,
    });

    const empresa = await this.createEmpresaBase(data, userId);

    // Invalidar cache de lista de empresas del usuario
    await this.cache.invalidate(this.cache.getUserEmpresasKey(userId));

    // Operaciones no críticas en paralelo: catálogos + unidades de medida
    const [catalogosResult, unidadesResult] = await Promise.allSettled([
      this.catalogosService.activarCatalogosSegunRubro(empresa.id, empresa.rubro),
      this.catalogosService.activarUnidadesPopularesParaEmpresa(empresa.id),
    ]);

    if (catalogosResult.status === 'fulfilled') {
      const catalogos = catalogosResult.value;
      this.logger.log(
        `Catálogos de ${empresa.rubro} activados: ${catalogos.total} catálogos (${catalogos.categorias.length} categorías, ${catalogos.marcas.length} marcas)`,
      );
    } else {
      this.logger.warn(`Error al activar catálogos de ${empresa.rubro}`, {
        error: catalogosResult.reason?.message,
        empresaId: empresa.id,
      });
    }

    if (unidadesResult.status === 'fulfilled') {
      this.logger.log(
        `Unidades de medida populares activadas: ${unidadesResult.value.total} unidades`,
      );
    } else {
      this.logger.warn('Error al activar unidades de medida populares', {
        error: unidadesResult.reason?.message,
        empresaId: empresa.id,
      });
    }

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

    // Invalidar cache de lista de empresas del usuario
    await this.cache.invalidate(this.cache.getUserEmpresasKey(userId));

    // Activar catálogos según preferencias
    try {
      const usarRecomendados =
        !categoriasMaestrasIds &&
        !marcasMaestrasIds &&
        !categoriasPersonalizadas &&
        !marcasPersonalizadas;

      if (usarRecomendados) {
        // Catálogos recomendados del rubro + unidades en paralelo
        const [catalogosResult, unidadesResult] = await Promise.allSettled([
          this.catalogosService.activarCatalogosSegunRubro(empresa.id, empresa.rubro),
          this.catalogosService.activarUnidadesPopularesParaEmpresa(empresa.id),
        ]);

        if (catalogosResult.status === 'fulfilled') {
          const catalogos = catalogosResult.value;
          this.logger.log(
            `Catálogos activados: ${catalogos.total} (${catalogos.categorias.length} categorías, ${catalogos.marcas.length} marcas)`,
          );
        } else {
          this.logger.warn(`Error al activar catálogos: ${catalogosResult.reason?.message}`);
        }

        if (unidadesResult.status === 'fulfilled') {
          this.logger.log(`Unidades populares activadas: ${unidadesResult.value.total}`);
        } else {
          this.logger.warn(`Error al activar unidades: ${unidadesResult.reason?.message}`);
        }
      } else {
        // Activar catálogos personalizados en paralelo (no secuencialmente)
        this.logger.log(`Activando catálogos personalizados para empresa ${empresa.id}`);

        const activationPromises: Promise<any>[] = [];

        if (categoriasMaestrasIds?.length > 0) {
          activationPromises.push(
            ...categoriasMaestrasIds.map((categoriaId: string) =>
              this.catalogosService.activarCategoriaParaEmpresa({
                empresaId: empresa.id,
                categoriaMaestraId: categoriaId,
              }),
            ),
          );
        }

        if (marcasMaestrasIds?.length > 0) {
          activationPromises.push(
            ...marcasMaestrasIds.map((marcaId: string) =>
              this.catalogosService.activarMarcaParaEmpresa({
                empresaId: empresa.id,
                marcaMaestraId: marcaId,
              }),
            ),
          );
        }

        if (categoriasPersonalizadas?.length > 0) {
          activationPromises.push(
            ...categoriasPersonalizadas.map((categoria: any) =>
              this.catalogosService.activarCategoriaParaEmpresa({
                empresaId: empresa.id,
                nombrePersonalizado: categoria.nombre,
                descripcionPersonalizada: categoria.descripcion,
              }),
            ),
          );
        }

        if (marcasPersonalizadas?.length > 0) {
          activationPromises.push(
            ...marcasPersonalizadas.map((marca: any) =>
              this.catalogosService.activarMarcaParaEmpresa({
                empresaId: empresa.id,
                nombrePersonalizado: marca.nombre,
                descripcionPersonalizada: marca.descripcion,
              }),
            ),
          );
        }

        // Ejecutar todas las activaciones + unidades en paralelo
        const results = await Promise.allSettled([
          ...activationPromises,
          this.catalogosService.activarUnidadesPopularesParaEmpresa(empresa.id),
        ]);

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;
        this.logger.log(
          `Catálogos personalizados: ${succeeded} activados, ${failed} fallidos`,
        );

        if (failed > 0) {
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              this.logger.warn(`Error en activación ${index}: ${result.reason?.message}`);
            }
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Error al activar catálogos: ${error.message}`);
    }

    return this.formatEmpresaResponse(empresa);
  }

  /**
   * Método base para crear empresa (sin activación automática de catálogos)
   * Reutilizable por createEmpresa y createEmpresaConCatalogos
   *
   * Optimizaciones:
   * - Validaciones en paralelo (RUC + subdominio + plan) con Promise.all
   * - Transacción atómica para empresa + configuraciones + rol + sede
   * - Creates independientes en paralelo dentro de la transacción
   */
  private async createEmpresaBase(
    data: CreateEmpresaData,
    userId: string,
  ): Promise<any> {
    // Validar que el perfil del usuario esté completo
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { persona: true },
    });

    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }

    const persona = usuario.persona;
    const camposFaltantes: string[] = [];
    if (!persona.dni) camposFaltantes.push('dni');
    if (!persona.telefono && !usuario.telefono) camposFaltantes.push('telefono');
    if (!persona.direccion) camposFaltantes.push('direccion');

    if (camposFaltantes.length > 0) {
      throw new BadRequestException({
        message: 'Debes completar tu perfil antes de crear una empresa',
        errorCode: 'PROFILE_INCOMPLETE',
        camposFaltantes,
      });
    }

    const { nombre, ruc, subdominio, rubro, condicionContribuyente } = data;

    // Validar condición del contribuyente SUNAT
    if (!condicionContribuyente || condicionContribuyente.toUpperCase() !== 'HABIDO') {
      this.logger.warn('Empresa creation rejected: condición no es HABIDO', {
        ruc,
        condicion: condicionContribuyente,
      });
      throw new BadRequestException(
        `No se puede registrar la empresa. La condición del contribuyente es "${condicionContribuyente}". Solo se permiten empresas con condición HABIDO.`,
      );
    }

    // Parallelizar validaciones independientes: RUC + subdominio + plan básico
    const [existingRuc, existingSubdomain, planBasico] = await Promise.all([
      ruc
        ? this.prisma.empresa.findFirst({ where: { ruc, deletedAt: null } })
        : Promise.resolve(null),
      subdominio
        ? this.prisma.empresa.findFirst({ where: { subdominio, deletedAt: null } })
        : Promise.resolve(null),
      this.prisma.planSuscripcion.findFirst({
        where: { nombre: 'BÁSICO', isActive: true },
      }),
    ]);

    if (existingRuc) {
      this.logger.warn('Empresa creation failed: RUC already exists', { ruc, userId });
      throw new ConflictException('Ya existe una empresa con este RUC');
    }
    if (existingSubdomain) {
      this.logger.warn('Empresa creation failed: Subdomain already in use', { subdominio, userId });
      throw new ConflictException('Este subdominio ya está en uso');
    }
    if (!planBasico) {
      throw new BadRequestException(
        'No se encontró el plan básico. Por favor, contacte al administrador.',
      );
    }

    // Generar subdominio único si no se proporciona
    let subdominioFinal = subdominio;
    if (!subdominioFinal) {
      subdominioFinal = this.generateSubdominio(nombre);
      let attempts = 0;
      while (
        await this.prisma.empresa.findFirst({
          where: { subdominio: subdominioFinal, deletedAt: null },
        })
      ) {
        subdominioFinal = this.generateSubdominio(nombre, ++attempts);
      }
    }

    const ahora = new Date();
    const fechaFinPrueba = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Transacción atómica: crear empresa + configuraciones + rol + sede
    const empresa = await this.prisma.$transaction(
      async (tx) => {
        // 1. Crear la empresa con datos SUNAT
        const emp = await tx.empresa.create({
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
            // Datos SUNAT
            razonSocial: data.razonSocial,
            tipoContribuyente: data.tipoContribuyente,
            estadoContribuyente: data.estadoContribuyente,
            condicionContribuyente: data.condicionContribuyente,
            direccionFiscal: data.direccionFiscal,
            departamento: data.departamento,
            provincia: data.provincia,
            distrito: data.distrito,
            ubigeo: data.ubigeo,
            // Suscripción
            planSuscripcionId: planBasico.id,
            fechaInicioSuscripcion: ahora,
            fechaVencimiento: fechaFinPrueba,
            estadoSuscripcion: EstadoSuscripcion.ACTIVA,
            usuariosActuales: 1,
            // Web gratuita por 2 meses
            fechaFinWebGratuita: new Date(ahora.getTime() + 60 * 24 * 60 * 60 * 1000),
          },
          include: {
            planSuscripcion: true,
          },
        });

        // 2. Crear configuraciones, rol y sede en paralelo (solo dependen de empresa.id)
        const codigoSede = `SEDE-${String(1).padStart(3, '0')}`;

        await Promise.all([
          tx.configuracionCodigos.create({
            data: {
              empresaId: emp.id,
              productoCodigo: 'PROD',
              productoSeparador: '-',
              productoLongitud: 6,
              productoIncluirSede: false,
              servicioCodigo: 'SERV',
              servicioSeparador: '-',
              servicioLongitud: 6,
              servicioIncluirSede: false,
              ultimoProducto: 0,
              ultimoServicio: 0,
            },
          }),
          tx.configuracionFacturacion.create({
            data: {
              empresaId: emp.id,
              entorno: 'BETA',
              textoPiePagina: 'Gracias por su compra',
              incluirIGV: true,
              incluirDetalles: true,
              formatoPapel: 'A4',
              porcentajeIGV: 18.0,
            },
          }),
          tx.configuracionEmpresa.create({
            data: {
              empresaId: emp.id,
            },
          }),
          tx.empresaUsuarioRol.create({
            data: {
              usuarioId: userId,
              empresaId: emp.id,
              rol: Rol.EMPRESA_ADMIN,
              estado: 'ACTIVO' as any,
              creadoPor: userId,
              registradoPor: userId,
              fechaAprobacion: ahora,
              aprobadoPor: userId,
            },
          }),
          tx.sede.create({
            data: {
              empresaId: emp.id,
              codigo: codigoSede,
              nombre: 'Sede Principal',
              telefono: data.telefono,
              email: data.email,
              direccion: data.direccionFiscal || 'Dirección por configurar',
              departamento: data.departamento,
              provincia: data.provincia,
              distrito: data.distrito,
              esPrincipal: true,
              tipoSede: 'OPERATIVA_COMPLETA',
              serieFactura: 'F001',
              serieBoleta: 'B001',
              serieNotaCredito: 'FC01',
              serieNotaCreditoBoleta: 'BC01',
              serieNotaDebito: 'FD01',
              serieNotaDebitoBoleta: 'BD01',
              serieGuiaRemision: 'GR01',
              ultimoNumeroFactura: 0,
              ultimoNumeroBoleta: 0,
              ultimoNumeroNotaCredito: 0,
              ultimoNumeroNotaCreditoBoleta: 0,
              ultimoNumeroNotaDebito: 0,
              ultimoNumeroNotaDebitoBoleta: 0,
              ultimoNumeroGuiaRemision: 0,
            },
          }),
        ]);

        return emp;
      },
      { timeout: 15000 },
    );

    // Operación no crítica post-transacción: configuración de documentos PDF
    try {
      await this.configuracionDocumentosService.seedDefaults(empresa.id);
      this.logger.log('Configuracion de documentos creada exitosamente');
    } catch (error) {
      this.logger.warn('Error al crear configuracion de documentos', {
        error: error.message,
        empresaId: empresa.id,
      });
    }

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
    const cacheKey = this.cache.getUserEmpresasKey(userId);

    return this.cache.getOrSet(
      cacheKey,
      () => this._fetchEmpresasByUsuario(userId),
      180, // 3 minutos
    );
  }

  /**
   * Obtiene las empresas del usuario desde la BD (sin cache)
   */
  private async _fetchEmpresasByUsuario(userId: string): Promise<EmpresaResponse[]> {
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
        razonSocial: data.razonSocial,
        direccionFiscal: data.direccionFiscal,
        departamento: data.departamento,
        provincia: data.provincia,
        distrito: data.distrito,
        ubigeo: data.ubigeo,
        ...(data.aceptaTercerizacion !== undefined && { aceptaTercerizacion: data.aceptaTercerizacion }),
        ...(data.descripcionTercerizacion !== undefined && { descripcionTercerizacion: data.descripcionTercerizacion }),
        ...(data.tiposServicioTercerizacion !== undefined && { tiposServicioTercerizacion: data.tiposServicioTercerizacion }),
      },
      include: {
        planSuscripcion: true,
      },
    });

    // Invalidar caches relacionados a la empresa
    await this.cache.invalidateEmpresa(empresaId);

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
      // Tercerización B2B
      aceptaTercerizacion: empresa.aceptaTercerizacion ?? false,
      descripcionTercerizacion: empresa.descripcionTercerizacion ?? null,
      tiposServicioTercerizacion: empresa.tiposServicioTercerizacion ?? null,
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
        limiteAlmacenamientoMB: true,
        precioSemestral: true,
        precioAnual: true,
        tieneWebPermanente: true,
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
  async cambiarPlan(empresaId: string, userId: string, planId: string, periodo: string = 'MENSUAL'): Promise<EmpresaResponse> {
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
        isActive: true,
      },
    });

    if (!nuevoPlan) {
      throw new NotFoundException('Plan de suscripción no encontrado o no está disponible');
    }

    // Validar downgrade: verificar que los recursos actuales no excedan los nuevos límites
    const stats = await this.calculateStatistics(empresaId);

    if (nuevoPlan.limiteProductos !== null && stats.totalProductos > nuevoPlan.limiteProductos) {
      throw new BadRequestException(
        `No puedes cambiar a este plan. Tienes ${stats.totalProductos} productos y el plan "${nuevoPlan.nombre}" permite máximo ${nuevoPlan.limiteProductos}.`,
      );
    }
    if (nuevoPlan.limiteServicios !== null && stats.totalServicios > nuevoPlan.limiteServicios) {
      throw new BadRequestException(
        `No puedes cambiar a este plan. Tienes ${stats.totalServicios} servicios y el plan "${nuevoPlan.nombre}" permite máximo ${nuevoPlan.limiteServicios}.`,
      );
    }
    if (nuevoPlan.limiteUsuarios !== null && stats.totalUsuarios > nuevoPlan.limiteUsuarios) {
      throw new BadRequestException(
        `No puedes cambiar a este plan. Tienes ${stats.totalUsuarios} usuarios y el plan "${nuevoPlan.nombre}" permite máximo ${nuevoPlan.limiteUsuarios}.`,
      );
    }
    if (nuevoPlan.limiteSedes !== null && stats.totalSedes > nuevoPlan.limiteSedes) {
      throw new BadRequestException(
        `No puedes cambiar a este plan. Tienes ${stats.totalSedes} sedes y el plan "${nuevoPlan.nombre}" permite máximo ${nuevoPlan.limiteSedes}.`,
      );
    }
    if (nuevoPlan.limiteCotizaciones !== null && stats.totalCotizaciones > nuevoPlan.limiteCotizaciones) {
      throw new BadRequestException(
        `No puedes cambiar a este plan. Tienes ${stats.totalCotizaciones} cotizaciones y el plan "${nuevoPlan.nombre}" permite máximo ${nuevoPlan.limiteCotizaciones}.`,
      );
    }

    // Calcular nueva fecha de vencimiento según el periodo de pago
    const ahora = new Date();
    let meses = 1;
    if (periodo === 'SEMESTRAL') meses = 6;
    else if (periodo === 'ANUAL') meses = 12;

    const nuevaFechaVencimiento = new Date(ahora);
    nuevaFechaVencimiento.setMonth(nuevaFechaVencimiento.getMonth() + meses);

    // Si es plan de pago, quitar límite de web gratuita
    const updateData: any = {
      planSuscripcionId: planId,
      fechaInicioSuscripcion: ahora,
      fechaVencimiento: nuevaFechaVencimiento,
      estadoSuscripcion: EstadoSuscripcion.ACTIVA,
    };

    if (nuevoPlan.tieneWebPermanente) {
      updateData.fechaFinWebGratuita = null; // Ya no necesita trial
    }

    // Actualizar el plan de la empresa
    const empresaActualizada = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: updateData,
      include: {
        planSuscripcion: true,
      },
    });

    // Invalidar cache de estadísticas
    await this.cache.invalidateEmpresa(empresaId);

    return this.formatEmpresaResponse(empresaActualizada);
  }

  /**
   * Calcula la fecha de vencimiento según el periodo de suscripción
   */
  private calcularFechaVencimiento(periodo: PeriodoSuscripcion): Date {
    const ahora = new Date();
    switch (periodo) {
      case PeriodoSuscripcion.MENSUAL:
        return new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
      case PeriodoSuscripcion.TRIMESTRAL:
        return new Date(ahora.getTime() + 90 * 24 * 60 * 60 * 1000);
      case PeriodoSuscripcion.SEMESTRAL:
        return new Date(ahora.getTime() + 180 * 24 * 60 * 60 * 1000);
      case PeriodoSuscripcion.ANUAL:
        return new Date(ahora.getTime() + 365 * 24 * 60 * 60 * 1000);
      case PeriodoSuscripcion.PERSONALIZADO:
        // Personalizado: default a 30 días
        return new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Obtener contexto completo de la empresa
   * Incluye información de la empresa, roles del usuario, sedes, permisos y estadísticas
   */
  async getEmpresaContext(empresaId: string, userId: string): Promise<EmpresaContextResponseDto> {
    this.logger.info('Getting empresa context', { empresaId, userId });

    const cacheKey = this.cache.getEmpresaContextKey(empresaId, userId);

    return this.cache.getOrSet(
      cacheKey,
      () => this._buildEmpresaContext(empresaId, userId),
      600, // 10 minutos
    );
  }

  /**
   * Construye el contexto completo de empresa (sin cache)
   */
  private async _buildEmpresaContext(empresaId: string, userId: string): Promise<EmpresaContextResponseDto> {
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

    // 4. Calcular estadísticas y límites del plan
    const [statistics, planLimits] = await Promise.all([
      this.calculateStatistics(empresaId),
      this.planLimitsService.getPlanLimitsInfo(empresaId),
    ]);

    // 5. Calcular permisos basados en roles + overrides individuales
    //    cargados de UsuarioSedeRol (puedeAbrirCaja, puedeCerrarCaja).
    //    También recolectamos `accesosRapidosOcultos` consolidado entre
    //    todas las sedes del usuario para enviarlo al frontend.
    const sedeRoles = await this.prisma.usuarioSedeRol.findMany({
      where: {
        usuarioId: userId,
        sede: { empresaId, deletedAt: null },
        isActive: true,
        deletedAt: null,
      },
      select: {
        puedeAbrirCaja: true,
        puedeCerrarCaja: true,
        accesosRapidosOcultos: true,
        permisos: true,
      },
    });
    // Unión de todos los IDs ocultos en cualquier sede del usuario.
    // Si está oculto en alguna sede, se considera oculto. (Si en algún
    // futuro hay diferencias por sede, este consolidado debe ajustarse.)
    const accesosRapidosOcultos = Array.from(
      new Set(sedeRoles.flatMap((s) => s.accesosRapidosOcultos)),
    );
    // Permisos granulares (catálogo de strings) consolidados entre sedes.
    // El frontend usa este array para mostrar UI según capacidades del
    // usuario. El backend valida vía `PermissionsService.hasGranularPermission`.
    const granularPermissions = Array.from(
      new Set(sedeRoles.flatMap((s) => s.permisos)),
    );
    const overrides = {
      puedeAbrirCaja: sedeRoles.some((s) => s.puedeAbrirCaja),
      puedeCerrarCaja: sedeRoles.some((s) => s.puedeCerrarCaja),
      // Incluido para que calculatePermissions resuelva `caja.abrir` /
      // `caja.cerrar` por catálogo además del flag legacy (Fase A).
      permisos: granularPermissions,
    };
    const permissions = this.calculatePermissions(userRoles, overrides);
    permissions.accesosRapidosOcultos = accesosRapidosOcultos;
    permissions.granularPermissions = granularPermissions;

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
      razonSocial: empresa.razonSocial,
      rubro: empresa.rubro,
      tipoContribuyente: empresa.tipoContribuyente,
      estadoContribuyente: empresa.estadoContribuyente,
      condicionContribuyente: empresa.condicionContribuyente,
      direccionFiscal: empresa.direccionFiscal,
      departamento: empresa.departamento,
      provincia: empresa.provincia,
      distrito: empresa.distrito,
      ubigeo: empresa.ubigeo,
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
      empresaId: sede.empresaId,
      codigo: sede.codigo,
      nombre: sede.nombre,
      telefono: sede.telefono,
      email: sede.email,
      tipoSede: sede.tipoSede,
      direccion: sede.direccion,
      referencia: sede.referencia,
      distrito: sede.distrito,
      provincia: sede.provincia,
      departamento: sede.departamento,
      pais: sede.pais,
      coordenadas: sede.coordenadas,
      horarioAtencion: sede.horarioAtencion,
      configuracion: sede.configuracion,
      serieFactura: sede.serieFactura,
      serieBoleta: sede.serieBoleta,
      serieNotaCredito: sede.serieNotaCredito,
      serieNotaCreditoBoleta: sede.serieNotaCreditoBoleta,
      serieNotaDebito: sede.serieNotaDebito,
      serieNotaDebitoBoleta: sede.serieNotaDebitoBoleta,
      serieGuiaRemision: sede.serieGuiaRemision,
      ultimoNumeroFactura: sede.ultimoNumeroFactura,
      ultimoNumeroBoleta: sede.ultimoNumeroBoleta,
      ultimoNumeroNotaCredito: sede.ultimoNumeroNotaCredito,
      ultimoNumeroNotaCreditoBoleta: sede.ultimoNumeroNotaCreditoBoleta,
      ultimoNumeroNotaDebito: sede.ultimoNumeroNotaDebito,
      ultimoNumeroNotaDebitoBoleta: sede.ultimoNumeroNotaDebitoBoleta,
      ultimoNumeroGuiaRemision: sede.ultimoNumeroGuiaRemision,
      esPrincipal: sede.esPrincipal,
      isActive: sede.isActive,
      deletedAt: sede.deletedAt,
      creadoEn: sede.creadoEn,
      actualizadoEn: sede.actualizadoEn,
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
      planLimits,
    };
  }

  /**
   * Calcular permisos del usuario basado en sus roles en la empresa.
   * Acepta overrides individuales (flags `UsuarioSedeRol`) que amplían
   * los permisos del rol — ver `PermissionsService` para detalle.
   */
  private calculatePermissions(
    userRoles: EmpresaUsuarioRol[],
    overrides?: {
      puedeAbrirCaja?: boolean;
      puedeCerrarCaja?: boolean;
      permisos?: readonly string[];
    },
  ): EmpresaPermissionsDto {
    const roles = userRoles.map(r => r.rol);
    return this.permissionsService.calculatePermissions(roles, overrides);
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
          totalCotizaciones,
          totalProveedores,
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

      // Total de cotizaciones
      this.prisma.cotizacion.count({
        where: {
          empresaId,
        },
      }),

      // Total de proveedores activos
      this.prisma.proveedor.count({
        where: {
          empresaId,
          isActive: true,
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
          totalCotizaciones,
          totalProveedores,
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
          colorPrimario: '#437EFF',
          colorSecundario: '#06b6d4',
          colorAcento: '#437EFF',
          bannerColor: '#000000',
          webConfig: { colorFondo1: '#06b6d4', colorFondo2: '#5b8fd4' },
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
          banners: data.banners ?? undefined,
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
          banners: data.banners ?? undefined,
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

  /**
   * Obtener configuración fiscal/operativa de la empresa
   */
  getEtiquetasDefaultPorRubro(rubro: string) {
    const defaults: Record<string, any> = {
      TECNOLOGIA: {
        etiquetaSeccionEquipo: 'EQUIPO',
        etiquetaTipoEquipo: 'Tipo de equipo',
        etiquetaMarcaEquipo: 'Marca',
        etiquetaNumeroSerie: 'Número de serie',
        etiquetaCondicionEquipo: 'Condición del equipo',
        mostrarSeccionEquipo: true,
      },
      AUTOMOTRIZ: {
        etiquetaSeccionEquipo: 'VEHÍCULO',
        etiquetaTipoEquipo: 'Tipo de vehículo',
        etiquetaMarcaEquipo: 'Marca / Modelo',
        etiquetaNumeroSerie: 'Placa',
        etiquetaCondicionEquipo: 'Estado del vehículo',
        mostrarSeccionEquipo: true,
      },
      SALUD: {
        etiquetaSeccionEquipo: 'EQUIPO MÉDICO',
        etiquetaTipoEquipo: 'Tipo de equipo',
        etiquetaMarcaEquipo: 'Marca / Modelo',
        etiquetaNumeroSerie: 'Número de serie',
        etiquetaCondicionEquipo: 'Estado del equipo',
        mostrarSeccionEquipo: true,
      },
      HOGAR: {
        etiquetaSeccionEquipo: 'ELECTRODOMÉSTICO',
        etiquetaTipoEquipo: 'Tipo de electrodoméstico',
        etiquetaMarcaEquipo: 'Marca / Modelo',
        etiquetaNumeroSerie: 'Número de serie',
        etiquetaCondicionEquipo: 'Estado del equipo',
        mostrarSeccionEquipo: true,
      },
      CONSTRUCCION: {
        etiquetaSeccionEquipo: 'MAQUINARIA',
        etiquetaTipoEquipo: 'Tipo de maquinaria',
        etiquetaMarcaEquipo: 'Marca / Modelo',
        etiquetaNumeroSerie: 'Número de serie / Placa',
        etiquetaCondicionEquipo: 'Estado de la maquinaria',
        mostrarSeccionEquipo: true,
      },
      GASTRONOMIA: {
        mostrarSeccionEquipo: false,
      },
      MODA: {
        mostrarSeccionEquipo: false,
      },
      EDUCACION: {
        mostrarSeccionEquipo: false,
      },
      DEPORTES: {
        etiquetaSeccionEquipo: 'ARTÍCULO',
        etiquetaTipoEquipo: 'Tipo de artículo',
        etiquetaMarcaEquipo: 'Marca',
        etiquetaNumeroSerie: 'Referencia',
        etiquetaCondicionEquipo: 'Estado del artículo',
        mostrarSeccionEquipo: true,
      },
    };

    return defaults[rubro] ?? defaults.TECNOLOGIA;
  }

  async getConfiguracion(empresaId: string, userId: string): Promise<ConfiguracionEmpresaResponseDto> {
    this.logger.info('Getting empresa configuration', { empresaId, userId });

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

    // Buscar configuración existente
    let configuracion = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
    });

    // Si no existe, crear una con valores por defecto
    if (!configuracion) {
      this.logger.info('Creating default configuration', { empresaId });
      configuracion = await this.prisma.configuracionEmpresa.create({
        data: {
          empresaId,
        },
      });
    }

    // Consolidar IGV: ConfigFacturacion.porcentajeIGV es la fuente de verdad
    const configFacturacion = await this.prisma.configuracionFacturacion.findUnique({
      where: { empresaId },
      select: { porcentajeIGV: true },
    });
    if (configFacturacion?.porcentajeIGV != null) {
      (configuracion as any).impuestoDefaultPorcentaje = Number(configFacturacion.porcentajeIGV);
    }

    this.logger.success('Configuration retrieved successfully', { empresaId });
    return configuracion as ConfiguracionEmpresaResponseDto;
  }

  /**
   * Actualizar configuración fiscal/operativa de la empresa
   */
  async updateConfiguracion(
    empresaId: string,
    userId: string,
    data: ConfiguracionEmpresaDto,
  ): Promise<ConfiguracionEmpresaResponseDto> {
    this.logger.info('Updating empresa configuration', { empresaId, userId });

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
      throw new ForbiddenException('No tienes permisos para modificar la configuración');
    }

    // Upsert: crear si no existe, actualizar si existe
    const configuracion = await this.prisma.configuracionEmpresa.upsert({
      where: { empresaId },
      update: {
        ...(data.impuestoDefaultPorcentaje !== undefined && { impuestoDefaultPorcentaje: data.impuestoDefaultPorcentaje }),
        ...(data.nombreImpuesto !== undefined && { nombreImpuesto: data.nombreImpuesto }),
        ...(data.monedaPrincipal !== undefined && { monedaPrincipal: data.monedaPrincipal }),
        ...(data.simboloMoneda !== undefined && { simboloMoneda: data.simboloMoneda }),
        ...(data.monedasPermitidas !== undefined && { monedasPermitidas: data.monedasPermitidas }),
        ...(data.diasVigenciaCotizacion !== undefined && { diasVigenciaCotizacion: data.diasVigenciaCotizacion }),
        ...(data.condicionesDefault !== undefined && { condicionesDefault: data.condicionesDefault }),
        ...(data.etiquetaSeccionEquipo !== undefined && { etiquetaSeccionEquipo: data.etiquetaSeccionEquipo }),
        ...(data.etiquetaTipoEquipo !== undefined && { etiquetaTipoEquipo: data.etiquetaTipoEquipo }),
        ...(data.etiquetaMarcaEquipo !== undefined && { etiquetaMarcaEquipo: data.etiquetaMarcaEquipo }),
        ...(data.etiquetaNumeroSerie !== undefined && { etiquetaNumeroSerie: data.etiquetaNumeroSerie }),
        ...(data.etiquetaCondicionEquipo !== undefined && { etiquetaCondicionEquipo: data.etiquetaCondicionEquipo }),
        ...(data.mostrarSeccionEquipo !== undefined && { mostrarSeccionEquipo: data.mostrarSeccionEquipo }),
        ...(data.ventaCreditoHabilitada !== undefined && { ventaCreditoHabilitada: data.ventaCreditoHabilitada }),
        ...(data.interesHabilitado !== undefined && { interesHabilitado: data.interesHabilitado }),
        ...(data.porcentajeInteresDefault !== undefined && { porcentajeInteresDefault: data.porcentajeInteresDefault }),
        ...(data.interesEsEditable !== undefined && { interesEsEditable: data.interesEsEditable }),
        ...(data.moraHabilitada !== undefined && { moraHabilitada: data.moraHabilitada }),
        ...(data.porcentajeMoraDiario !== undefined && { porcentajeMoraDiario: data.porcentajeMoraDiario }),
        ...(data.moraMaximaPorcentaje !== undefined && { moraMaximaPorcentaje: data.moraMaximaPorcentaje }),
        ...(data.diasGraciaMora !== undefined && { diasGraciaMora: data.diasGraciaMora }),
      },
      create: {
        empresaId,
        impuestoDefaultPorcentaje: data.impuestoDefaultPorcentaje ?? 18.0,
        nombreImpuesto: data.nombreImpuesto ?? 'IGV',
        monedaPrincipal: data.monedaPrincipal ?? 'PEN',
        simboloMoneda: data.simboloMoneda ?? 'S/',
        monedasPermitidas: data.monedasPermitidas ?? ['PEN', 'USD'],
        diasVigenciaCotizacion: data.diasVigenciaCotizacion ?? 30,
        condicionesDefault: data.condicionesDefault ?? null,
      },
    });

    // Sincronizar IGV a ConfiguracionFacturacion (fuente de verdad para facturación)
    if (data.impuestoDefaultPorcentaje !== undefined) {
      await this.prisma.configuracionFacturacion.upsert({
        where: { empresaId },
        update: { porcentajeIGV: data.impuestoDefaultPorcentaje },
        create: { empresaId, porcentajeIGV: data.impuestoDefaultPorcentaje },
      });
    }

    this.logger.success('Configuration updated successfully', { empresaId });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_UPDATED,
      actor: { userId },
      target: {
        type: 'ConfiguracionEmpresa',
        id: configuracion.id,
        name: `Configuración de empresa ${empresaId}`,
      },
      metadata: data,
      success: true,
    });

    return configuracion as ConfiguracionEmpresaResponseDto;
  }
}