import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { AdminEmpresaFiltersDto } from './dto/admin-empresa-filters.dto';
import { AdminEmpresaUpdateDto } from './dto/admin-empresa-update.dto';
import { AdminEmpresaPlanDto } from './dto/admin-empresa-plan.dto';
import { AdminEmpresaSuscripcionDto } from './dto/admin-empresa-suscripcion.dto';
import { AdminUsuarioFiltersDto } from './dto/admin-usuario-filters.dto';
import { AdminUsuarioUpdateDto } from './dto/admin-usuario-update.dto';
import { AdminPlanUpdateDto } from './dto/admin-plan-update.dto';
import { AdminPagoFiltersDto } from './dto/admin-pago-filters.dto';
import { AdminPagoCreateDto } from './dto/admin-pago-create.dto';
import { AdminEnviarNotificacionDto, AdminEnviarUsuariosDto } from './dto/admin-notificacion.dto';
import { NotificacionService } from '../notificacion/notificacion.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { EstadoSuscripcion, PeriodoSuscripcion, EstadoPagoSuscripcion, TipoNotificacion } from '@prisma/client';
import { AuthSessionService } from '../auth/auth.session.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import { AdminCaracteristicaDto } from './dto/admin-caracteristica.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private logger: AppLoggerService,
    private cache: CacheService,
    private notificacionService: NotificacionService,
    private redisService: RedisService,
    private configService: ConfigService,
    private authSessionService: AuthSessionService,
    private caracteristicaEmpresa: CaracteristicaEmpresaService,
  ) {
    this.logger.setContext(AdminService.name);
  }

  // ===========================================================================
  // Características PREMIUM por empresa (gating) — solo super admin
  // ===========================================================================

  /** Lista las características premium configuradas de una empresa. */
  async listarCaracteristicasEmpresa(empresaId: string) {
    return this.caracteristicaEmpresa.listarPorEmpresa(empresaId);
  }

  /**
   * Activa/desactiva una característica premium de la empresa. Invalida el cache
   * del contexto de TODOS los usuarios de la empresa para que el cambio (mostrar/
   * ocultar la opción) se refleje al instante en sus apps.
   */
  async gestionarCaracteristicaEmpresa(
    empresaId: string,
    dto: AdminCaracteristicaDto,
    adminUserId: string,
  ) {
    // undefined = no cambiar la vigencia; null = permanente; string = fecha.
    const vigenteHasta =
      dto.vigenteHasta === undefined
        ? undefined
        : dto.vigenteHasta
          ? new Date(dto.vigenteHasta)
          : null;

    const row = await this.caracteristicaEmpresa.upsert(
      empresaId,
      dto.caracteristica,
      {
        habilitado: dto.habilitado,
        vigenteHasta,
        origen: dto.origen,
        notaAdmin: dto.notaAdmin,
        otorgadoPorId: adminUserId,
      },
    );

    await this.cache.invalidatePattern(`context:empresa:${empresaId}:user:*`);
    this.logger.info(
      `[ADMIN] Característica ${dto.caracteristica}=${dto.habilitado} para empresa ${empresaId} por ${adminUserId}`,
    );
    return row;
  }

  // ==========================================
  // DASHBOARD
  // ==========================================

  async getDashboard() {
    this.logger.log('Obteniendo dashboard admin');

    const [
      metrics,
      empresasPorPlan,
      registrosMensuales,
      topEmpresas,
      empresasProximasVencer,
      storageGlobal,
    ] = await Promise.all([
      this.getMetrics(),
      this.getEmpresasPorPlan(),
      this.getRegistrosMensuales(),
      this.getTopEmpresas(),
      this.getEmpresasProximasVencer(),
      this.getStorageGlobal(),
    ]);

    return {
      metrics,
      empresasPorPlan,
      registrosMensuales,
      topEmpresas,
      empresasProximasVencer,
      storageGlobal,
    };
  }

  private async getMetrics() {
    const [
      totalEmpresas,
      empresasActivas,
      empresasVencidas,
      empresasSuspendidas,
      empresasEnProbation,
      totalUsuarios,
      ingresosMensuales,
    ] = await Promise.all([
      this.prisma.empresa.count({ where: { deletedAt: null } }),
      this.prisma.empresa.count({ where: { estadoSuscripcion: EstadoSuscripcion.ACTIVA, deletedAt: null } }),
      this.prisma.empresa.count({ where: { estadoSuscripcion: EstadoSuscripcion.VENCIDA, deletedAt: null } }),
      this.prisma.empresa.count({ where: { estadoSuscripcion: EstadoSuscripcion.SUSPENDIDA, deletedAt: null } }),
      this.prisma.empresa.count({ where: { estadoSuscripcion: EstadoSuscripcion.EN_PROBATION, deletedAt: null } }),
      this.prisma.usuario.count({ where: { deletedAt: null } }),
      this.calcularIngresosMensuales(),
    ]);

    return {
      totalEmpresas,
      empresasActivas,
      empresasVencidas,
      empresasSuspendidas,
      empresasEnProbation,
      totalUsuarios,
      ingresosMensuales,
    };
  }

  private async calcularIngresosMensuales(): Promise<number> {
    const result = await this.prisma.empresa.findMany({
      where: {
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
        deletedAt: null,
        planSuscripcion: { precio: { gt: 0 } },
      },
      select: {
        planSuscripcion: { select: { precio: true } },
      },
    });

    return result.reduce((sum, e) => sum + Number(e.planSuscripcion?.precio || 0), 0);
  }

  private async getEmpresasPorPlan() {
    const result = await this.prisma.empresa.groupBy({
      by: ['planSuscripcionId'],
      where: { deletedAt: null },
      _count: { id: true },
    });

    const planes = await this.prisma.planSuscripcion.findMany({
      where: { id: { in: result.map(r => r.planSuscripcionId).filter(Boolean) } },
      select: { id: true, nombre: true },
    });

    const planesMap = new Map(planes.map(p => [p.id, p.nombre]));

    return result
      .filter(r => r.planSuscripcionId)
      .map(r => ({
        planId: r.planSuscripcionId,
        planNombre: planesMap.get(r.planSuscripcionId) || 'Sin plan',
        count: r._count.id,
      }));
  }

  private async getRegistrosMensuales() {
    const hace12Meses = new Date();
    hace12Meses.setMonth(hace12Meses.getMonth() - 12);

    const empresas = await this.prisma.empresa.findMany({
      where: {
        creadoEn: { gte: hace12Meses },
        deletedAt: null,
      },
      select: { creadoEn: true },
    });

    const mesesMap = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      mesesMap.set(key, 0);
    }

    empresas.forEach(e => {
      const key = `${e.creadoEn.getFullYear()}-${String(e.creadoEn.getMonth() + 1).padStart(2, '0')}`;
      if (mesesMap.has(key)) {
        mesesMap.set(key, mesesMap.get(key) + 1);
      }
    });

    return Array.from(mesesMap.entries()).map(([mes, count]) => ({ mes, count }));
  }

  private async getTopEmpresas() {
    const empresas = await this.prisma.empresa.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        nombre: true,
        usuariosActuales: true,
        planSuscripcion: { select: { nombre: true } },
        _count: {
          select: {
            productos: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { usuariosActuales: 'desc' },
      take: 10,
    });

    return empresas.map(e => ({
      id: e.id,
      nombre: e.nombre,
      productos: e._count.productos,
      usuarios: e.usuariosActuales,
      plan: e.planSuscripcion?.nombre || 'Sin plan',
    }));
  }

  private async getEmpresasProximasVencer() {
    const ahora = new Date();
    const en30Dias = new Date();
    en30Dias.setDate(en30Dias.getDate() + 30);

    const empresas = await this.prisma.empresa.findMany({
      where: {
        deletedAt: null,
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
        fechaVencimiento: {
          gte: ahora,
          lte: en30Dias,
        },
      },
      select: {
        id: true,
        nombre: true,
        fechaVencimiento: true,
        planSuscripcion: { select: { nombre: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
      take: 20,
    });

    return empresas.map(e => ({
      id: e.id,
      nombre: e.nombre,
      plan: e.planSuscripcion?.nombre || 'Sin plan',
      fechaVencimiento: e.fechaVencimiento,
      diasRestantes: Math.ceil(
        (e.fechaVencimiento.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));
  }

  private async getStorageGlobal() {
    const result = await this.prisma.archivo.aggregate({
      _sum: { tamanoBytes: true },
    });

    const totalUsedBytes = Number(result._sum.tamanoBytes || 0);
    const totalUsedMB = Math.round(totalUsedBytes / (1024 * 1024));

    // Sumar limites de almacenamiento de todas las empresas activas
    const planesLimites = await this.prisma.empresa.findMany({
      where: { deletedAt: null, estadoSuscripcion: EstadoSuscripcion.ACTIVA },
      select: { planSuscripcion: { select: { limiteAlmacenamientoMB: true } } },
    });

    const totalLimitMB = planesLimites.reduce(
      (sum, e) => sum + (e.planSuscripcion?.limiteAlmacenamientoMB || 0),
      0,
    );

    return { totalUsedMB, totalLimitMB };
  }

  // ==========================================
  // EMPRESAS
  // ==========================================

  async getEmpresas(filters: AdminEmpresaFiltersDto) {
    const { search, planId, estadoSuscripcion, isActive, page, pageSize, sortBy, sortOrder } = filters;

    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { ruc: { contains: search } },
        { subdominio: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (planId) where.planSuscripcionId = planId;
    if (estadoSuscripcion) where.estadoSuscripcion = estadoSuscripcion;
    if (isActive !== undefined) where.isActive = isActive;

    const [items, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          ruc: true,
          subdominio: true,
          isActive: true,
          estadoSuscripcion: true,
          fechaVencimiento: true,
          fechaInicioSuscripcion: true,
          usuariosActuales: true,
          creadoEn: true,
          planSuscripcion: { select: { id: true, nombre: true, precio: true } },
        },
        orderBy: { [sortBy || 'creadoEn']: sortOrder || 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      items: items.map(e => ({
        ...e,
        planNombre: e.planSuscripcion?.nombre || 'Sin plan',
        planPrecio: Number(e.planSuscripcion?.precio || 0),
        planId: e.planSuscripcion?.id,
        planSuscripcion: undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getEmpresaDetail(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: {
        planSuscripcion: true,
        _count: {
          select: {
            productos: { where: { deletedAt: null } },
            servicios: { where: { deletedAt: null } },
            sedes: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!empresa || empresa.deletedAt) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const [usuariosCount, storageUsed, usuarios] = await Promise.all([
      this.prisma.empresaUsuarioRol.count({
        where: { empresaId: id, deletedAt: null, isActive: true },
      }),
      this.prisma.archivo.aggregate({
        where: { empresaId: id },
        _sum: { tamanoBytes: true },
      }),
      this.prisma.empresaUsuarioRol.findMany({
        where: { empresaId: id, deletedAt: null },
        select: {
          rol: true,
          estado: true,
          isActive: true,
          creadoEn: true,
          usuario: {
            select: {
              id: true,
              email: true,
              isActive: true,
              persona: { select: { nombres: true, apellidos: true, dni: true } },
            },
          },
        },
        take: 50,
      }),
    ]);

    return {
      ...empresa,
      stats: {
        totalProductos: empresa._count.productos,
        totalServicios: empresa._count.servicios,
        totalSedes: empresa._count.sedes,
        totalUsuarios: usuariosCount,
        storageUsedMB: Math.round(Number(storageUsed._sum.tamanoBytes || 0) / (1024 * 1024)),
      },
      usuarios: usuarios.map(u => ({
        id: u.usuario.id,
        email: u.usuario.email,
        nombres: u.usuario.persona?.nombres,
        apellidos: u.usuario.persona?.apellidos,
        dni: u.usuario.persona?.dni,
        rol: u.rol,
        estado: u.estado,
        isActive: u.isActive,
      })),
    };
  }

  async updateEmpresa(id: string, dto: AdminEmpresaUpdateDto) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa || empresa.deletedAt) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const data: any = {};
    if (dto.estadoSuscripcion !== undefined) data.estadoSuscripcion = dto.estadoSuscripcion;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.empresa.update({ where: { id }, data });

    this.logger.log(`Empresa ${id} actualizada por admin`, { ...dto });
    await this.cache.invalidateEmpresa(id);

    return updated;
  }

  async changeEmpresaPlan(id: string, dto: AdminEmpresaPlanDto) {
    const [empresa, plan] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id } }),
      this.prisma.planSuscripcion.findUnique({ where: { id: dto.planId } }),
    ]);

    if (!empresa || empresa.deletedAt) throw new NotFoundException('Empresa no encontrada');
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const ahora = new Date();
    const fechaVencimiento = new Date(ahora);
    switch (dto.periodo) {
      case PeriodoSuscripcion.MENSUAL:
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1);
        break;
      case PeriodoSuscripcion.TRIMESTRAL:
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 3);
        break;
      case PeriodoSuscripcion.SEMESTRAL:
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 6);
        break;
      case PeriodoSuscripcion.ANUAL:
        fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
        break;
      default:
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1);
    }

    const updated = await this.prisma.empresa.update({
      where: { id },
      data: {
        planSuscripcionId: dto.planId,
        fechaInicioSuscripcion: ahora,
        fechaVencimiento,
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
      },
      include: { planSuscripcion: true },
    });

    this.logger.log(`Plan de empresa ${id} cambiado a ${plan.nombre} por admin`);
    await this.cache.invalidateEmpresa(id);

    return updated;
  }

  async updateEmpresaSuscripcion(id: string, dto: AdminEmpresaSuscripcionDto) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa || empresa.deletedAt) throw new NotFoundException('Empresa no encontrada');

    const data: any = {};
    if (dto.fechaVencimiento) data.fechaVencimiento = new Date(dto.fechaVencimiento);
    if (dto.estadoSuscripcion) data.estadoSuscripcion = dto.estadoSuscripcion;

    const updated = await this.prisma.empresa.update({
      where: { id },
      data,
      include: { planSuscripcion: true },
    });

    this.logger.log(`Suscripción de empresa ${id} actualizada por admin`, { ...dto });
    await this.cache.invalidateEmpresa(id);

    return updated;
  }

  // ==========================================
  // USUARIOS
  // ==========================================

  async getUsuarios(filters: AdminUsuarioFiltersDto) {
    const { search, rolGlobal, isActive, page, pageSize } = filters;

    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { persona: { nombres: { contains: search, mode: 'insensitive' } } },
        { persona: { apellidos: { contains: search, mode: 'insensitive' } } },
        { persona: { dni: { contains: search } } },
      ];
    }
    if (rolGlobal) where.rolGlobal = rolGlobal;
    if (isActive !== undefined) where.isActive = isActive;

    const [items, total] = await Promise.all([
      this.prisma.usuario.findMany({
        where,
        select: {
          id: true,
          email: true,
          telefono: true,
          rolGlobal: true,
          isActive: true,
          emailVerificado: true,
          creadoEn: true,
          persona: { select: { nombres: true, apellidos: true, dni: true } },
          _count: {
            select: {
              empresas: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.usuario.count({ where }),
    ]);

    return {
      items: items.map(u => ({
        id: u.id,
        email: u.email,
        telefono: u.telefono,
        nombres: u.persona?.nombres,
        apellidos: u.persona?.apellidos,
        dni: u.persona?.dni,
        rolGlobal: u.rolGlobal,
        isActive: u.isActive,
        emailVerificado: u.emailVerificado,
        empresasCount: u._count.empresas,
        creadoEn: u.creadoEn,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getUsuarioDetail(id: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
      include: {
        persona: true,
        empresas: {
          where: { deletedAt: null },
          include: {
            empresa: {
              select: { id: true, nombre: true, ruc: true, subdominio: true, estadoSuscripcion: true },
            },
          },
        },
      },
    });

    if (!usuario || usuario.deletedAt) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      id: usuario.id,
      email: usuario.email,
      telefono: usuario.telefono,
      rolGlobal: usuario.rolGlobal,
      isActive: usuario.isActive,
      emailVerificado: usuario.emailVerificado,
      creadoEn: usuario.creadoEn,
      persona: {
        nombres: usuario.persona?.nombres,
        apellidos: usuario.persona?.apellidos,
        dni: usuario.persona?.dni,
        direccion: usuario.persona?.direccion,
      },
      empresas: usuario.empresas.map(eur => ({
        empresaId: eur.empresa.id,
        empresaNombre: eur.empresa.nombre,
        empresaRuc: eur.empresa.ruc,
        empresaEstado: eur.empresa.estadoSuscripcion,
        rol: eur.rol,
        estado: eur.estado,
        isActive: eur.isActive,
      })),
    };
  }

  async updateUsuario(id: string, dto: AdminUsuarioUpdateDto) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario || usuario.deletedAt) throw new NotFoundException('Usuario no encontrado');

    const updated = await this.prisma.usuario.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    // Invalidar cache de isActive y, si se desactiva, revocar todas las
    // sesiones para corte inmediato. Sin esto, el JwtStrategy seguiría
    // viendo al usuario como activo hasta que expire su cache (30s) y
    // sus sesiones Redis seguirían vivas hasta el TTL.
    await this.authSessionService.invalidateUserActiveCache(id);
    if (dto.isActive === false) {
      await this.authSessionService.revokeAllUserSessions(id);
    }

    this.logger.log(`Usuario ${id} ${dto.isActive ? 'desbloqueado' : 'bloqueado'} por admin`, {
      motivo: dto.motivo,
    });

    return { id: updated.id, isActive: updated.isActive, message: dto.isActive ? 'Usuario desbloqueado' : 'Usuario bloqueado' };
  }

  // ==========================================
  // PLANES
  // ==========================================

  async getPlanes() {
    const planes = await this.prisma.planSuscripcion.findMany({
      include: {
        _count: {
          select: {
            empresas: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { precio: 'asc' },
    });

    return planes.map(p => ({
      ...p,
      precio: Number(p.precio),
      precioSemestral: p.precioSemestral ? Number(p.precioSemestral) : null,
      precioAnual: p.precioAnual ? Number(p.precioAnual) : null,
      empresasCount: p._count.empresas,
    }));
  }

  async getPlanDetail(id: string) {
    const plan = await this.prisma.planSuscripcion.findUnique({
      where: { id },
      include: {
        empresas: {
          where: { deletedAt: null },
          select: {
            id: true,
            nombre: true,
            ruc: true,
            estadoSuscripcion: true,
            fechaVencimiento: true,
            usuariosActuales: true,
          },
          take: 50,
        },
      },
    });

    if (!plan) throw new NotFoundException('Plan no encontrado');

    return {
      ...plan,
      precio: Number(plan.precio),
      precioSemestral: plan.precioSemestral ? Number(plan.precioSemestral) : null,
      precioAnual: plan.precioAnual ? Number(plan.precioAnual) : null,
      empresasCount: plan.empresas.length,
    };
  }

  async updatePlan(id: string, dto: AdminPlanUpdateDto) {
    const plan = await this.prisma.planSuscripcion.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const data: any = {};
    Object.entries(dto).forEach(([key, value]) => {
      if (value !== undefined) data[key] = value;
    });

    // Si el cliente no envía caracteristicas explícito, lo regeneramos desde
    // los campos tipados para mantener el JSON sincronizado con la fuente de
    // verdad (límites + toggles).
    if (data.caracteristicas === undefined) {
      data.caracteristicas = this.buildCaracteristicas({ ...plan, ...data });
    }

    const updated = await this.prisma.planSuscripcion.update({
      where: { id },
      data,
    });

    this.logger.log(`Plan ${id} actualizado por admin`, { cambios: Object.keys(data) });

    return {
      ...updated,
      precio: Number(updated.precio),
      precioSemestral: updated.precioSemestral ? Number(updated.precioSemestral) : null,
      precioAnual: updated.precioAnual ? Number(updated.precioAnual) : null,
    };
  }

  private buildCaracteristicas(plan: {
    nombre: string;
    limiteProductos: number | null;
    limiteServicios: number | null;
    limiteUsuarios: number | null;
    limiteSedes: number | null;
    limitePlantillasAtributos: number | null;
    limiteCotizaciones: number | null;
    limiteAlmacenamientoMB: number | null;
    tieneWebPermanente: boolean;
    tienePersonalizacion: boolean;
    tieneDominioPropio: boolean;
    tieneApi: boolean;
    tieneReportesAvanzados: boolean;
  }): Record<string, any> {
    const formatStorage = (mb: number | null): string => {
      if (mb == null) return 'ilimitado';
      if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}GB`;
      if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
      return `${mb}MB`;
    };

    const limit = (n: number | null): number | string => n ?? 'ilimitado';

    const isEmpresarial = plan.nombre === 'EMPRESARIAL';
    const isProfesional = plan.nombre === 'PROFESIONAL';

    const reportes = plan.tieneReportesAvanzados
      ? isEmpresarial
        ? 'avanzados_personalizados'
        : 'avanzados'
      : 'basicos';

    const soporte = isEmpresarial
      ? '24/7'
      : isProfesional
        ? 'email_telefono'
        : 'email';

    const result: Record<string, any> = {
      productos: limit(plan.limiteProductos),
      servicios: limit(plan.limiteServicios),
      usuarios: limit(plan.limiteUsuarios),
      sedes: limit(plan.limiteSedes),
      plantillas: limit(plan.limitePlantillasAtributos),
      cotizaciones: limit(plan.limiteCotizaciones),
      almacenamiento: formatStorage(plan.limiteAlmacenamientoMB),
      paginaWeb: plan.tieneWebPermanente ? 'permanente' : 'trial_2_meses',
      facturacion: true,
      inventario: true,
      clientes: true,
      reportes,
      soporte,
    };

    if (plan.tienePersonalizacion) result.personalizacion = true;
    if (plan.tieneApi) result.api = true;
    if (plan.tieneDominioPropio) result.dominio_propio = true;

    return result;
  }

  // ==========================================
  // STORAGE
  // ==========================================

  async getStorageUsage() {
    const empresas = await this.prisma.empresa.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        nombre: true,
        planSuscripcion: { select: { nombre: true, limiteAlmacenamientoMB: true } },
      },
    });

    const storageByEmpresa: { empresaId: string; total: bigint }[] =
      await this.prisma.$queryRaw`
        SELECT "empresaId", COALESCE(SUM("tamanoBytes"), 0) as total
        FROM "Archivo"
        GROUP BY "empresaId"
        ORDER BY total DESC
        LIMIT 20
      `;

    const empresaMap = new Map(empresas.map(e => [e.id, e]));
    const storageGlobal = await this.getStorageGlobal();

    return {
      global: storageGlobal,
      porEmpresa: storageByEmpresa.map(s => {
        const empresa = empresaMap.get(s.empresaId);
        return {
          empresaId: s.empresaId,
          empresaNombre: empresa?.nombre || 'Desconocida',
          plan: empresa?.planSuscripcion?.nombre || 'Sin plan',
          usedMB: Math.round(Number(s.total) / (1024 * 1024)),
          limitMB: empresa?.planSuscripcion?.limiteAlmacenamientoMB || 0,
        };
      }),
    };
  }

  // ==========================================
  // PAGOS DE SUSCRIPCIÓN
  // ==========================================

  async getPagos(filters: AdminPagoFiltersDto) {
    const { empresaId, planId, estado, metodoPago, fechaDesde, fechaHasta, page, pageSize } = filters;

    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (planId) where.planSuscripcionId = planId;
    if (estado) where.estado = estado;
    if (metodoPago) where.metodoPago = metodoPago;
    if (fechaDesde || fechaHasta) {
      where.fechaPago = {};
      if (fechaDesde) where.fechaPago.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaPago.lte = new Date(fechaHasta);
    }

    const [items, total] = await Promise.all([
      this.prisma.pagoSuscripcion.findMany({
        where,
        include: {
          empresa: { select: { id: true, nombre: true, ruc: true } },
          planSuscripcion: { select: { id: true, nombre: true } },
        },
        orderBy: { fechaPago: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pagoSuscripcion.count({ where }),
    ]);

    return {
      items: items.map(p => ({
        ...p,
        monto: Number(p.monto),
        empresaNombre: p.empresa?.nombre,
        empresaRuc: p.empresa?.ruc,
        planNombre: p.planSuscripcion?.nombre,
        empresa: undefined,
        planSuscripcion: undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async createPago(dto: AdminPagoCreateDto, userId: string) {
    const [empresa, plan] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: dto.empresaId } }),
      this.prisma.planSuscripcion.findUnique({ where: { id: dto.planSuscripcionId } }),
    ]);

    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const pago = await this.prisma.pagoSuscripcion.create({
      data: {
        empresaId: dto.empresaId,
        planSuscripcionId: dto.planSuscripcionId,
        monto: dto.monto,
        moneda: dto.moneda || 'PEN',
        periodo: dto.periodo,
        metodoPago: dto.metodoPago,
        referencia: dto.referencia,
        notas: dto.notas,
        estado: EstadoPagoSuscripcion.COMPLETADO,
        fechaPago: dto.fechaPago ? new Date(dto.fechaPago) : new Date(),
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: new Date(dto.fechaFin),
        registradoPor: userId,
      },
      include: {
        empresa: { select: { nombre: true } },
        planSuscripcion: { select: { nombre: true } },
      },
    });

    // Actualizar suscripción de la empresa automáticamente
    await this.prisma.empresa.update({
      where: { id: dto.empresaId },
      data: {
        planSuscripcionId: dto.planSuscripcionId,
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
        fechaInicioSuscripcion: new Date(dto.fechaInicio),
        fechaVencimiento: new Date(dto.fechaFin),
      },
    });

    await this.cache.invalidateEmpresa(dto.empresaId);

    this.logger.log(`Pago registrado para empresa ${empresa.nombre}`, {
      monto: dto.monto,
      plan: plan.nombre,
      periodo: dto.periodo,
    });

    return {
      ...pago,
      monto: Number(pago.monto),
    };
  }

  async anularPago(id: string) {
    const pago = await this.prisma.pagoSuscripcion.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const updated = await this.prisma.pagoSuscripcion.update({
      where: { id },
      data: { estado: EstadoPagoSuscripcion.ANULADO },
    });

    this.logger.log(`Pago ${id} anulado`);

    return { ...updated, monto: Number(updated.monto) };
  }

  async validarPago(id: string, adminUserId: string) {
    const pago = await this.prisma.pagoSuscripcion.findUnique({
      where: { id },
      include: { empresa: { select: { nombre: true } }, planSuscripcion: { select: { nombre: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (pago.estado === EstadoPagoSuscripcion.COMPLETADO) {
      throw new BadRequestException('Este pago ya fue validado');
    }

    // Actualizar pago a COMPLETADO
    const updated = await this.prisma.pagoSuscripcion.update({
      where: { id },
      data: {
        estado: EstadoPagoSuscripcion.COMPLETADO,
        pagoValidadoEn: new Date(),
        pagoValidadoPor: adminUserId,
      },
    });

    // Activar suscripción de la empresa
    await this.prisma.empresa.update({
      where: { id: pago.empresaId },
      data: {
        planSuscripcionId: pago.planSuscripcionId,
        estadoSuscripcion: EstadoSuscripcion.ACTIVA,
        fechaInicioSuscripcion: pago.fechaInicio,
        fechaVencimiento: pago.fechaFin,
      },
    });

    await this.cache.invalidateEmpresa(pago.empresaId);

    // Notificar al usuario que registró el pago
    if (pago.registradoPor) {
      try {
        await this.notificacionService.enviarAUsuario(
          pago.registradoPor,
          'Pago validado',
          `Tu pago de S/ ${Number(pago.monto).toFixed(2)} para el plan ${pago.planSuscripcion?.nombre} ha sido aprobado. Tu suscripción está activa.`,
          { tipo: TipoNotificacion.SISTEMA, empresaId: pago.empresaId },
        );
      } catch (e) {
        this.logger.warn(`Error notificando validación: ${e?.message}`);
      }
    }

    this.logger.log(`Pago ${id} validado por admin. Empresa: ${pago.empresa?.nombre}`);

    return { ...updated, monto: Number(updated.monto), message: 'Pago validado y suscripción activada' };
  }

  async rechazarPago(id: string, adminUserId: string, motivo: string) {
    const pago = await this.prisma.pagoSuscripcion.findUnique({
      where: { id },
      include: { empresa: { select: { nombre: true } }, planSuscripcion: { select: { nombre: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const updated = await this.prisma.pagoSuscripcion.update({
      where: { id },
      data: {
        estado: EstadoPagoSuscripcion.ANULADO,
        motivoRechazo: motivo,
        pagoValidadoEn: new Date(),
        pagoValidadoPor: adminUserId,
      },
    });

    // Notificar al usuario
    if (pago.registradoPor) {
      try {
        await this.notificacionService.enviarAUsuario(
          pago.registradoPor,
          'Pago rechazado',
          `Tu pago de S/ ${Number(pago.monto).toFixed(2)} fue rechazado. Motivo: ${motivo}. Puedes intentar nuevamente.`,
          { tipo: TipoNotificacion.SISTEMA, empresaId: pago.empresaId },
        );
      } catch (e) {
        this.logger.warn(`Error notificando rechazo: ${e?.message}`);
      }
    }

    this.logger.log(`Pago ${id} rechazado. Motivo: ${motivo}`);

    return { ...updated, monto: Number(updated.monto), message: 'Pago rechazado' };
  }

  async getIngresosReporte(fechaDesde?: string, fechaHasta?: string) {
    const where: any = { estado: EstadoPagoSuscripcion.COMPLETADO };
    if (fechaDesde || fechaHasta) {
      where.fechaPago = {};
      if (fechaDesde) where.fechaPago.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaPago.lte = new Date(fechaHasta);
    }

    // Total general
    const totalResult = await this.prisma.pagoSuscripcion.aggregate({
      where,
      _sum: { monto: true },
      _count: { id: true },
    });

    // Por plan (raw query para evitar tipos circulares de Prisma groupBy)
    const whereClause = where.fechaPago
      ? `AND "fechaPago" >= '${where.fechaPago.gte?.toISOString() || '1970-01-01'}' AND "fechaPago" <= '${where.fechaPago.lte?.toISOString() || '2100-01-01'}'`
      : '';
    const estadoClause = `"estado" = 'COMPLETADO'`;

    const pagosPorPlan: { planSuscripcionId: string; total: any; cantidad: bigint }[] =
      await this.prisma.$queryRawUnsafe(`
        SELECT "planSuscripcionId", COALESCE(SUM("monto"), 0) as total, COUNT(*) as cantidad
        FROM "PagoSuscripcion"
        WHERE ${estadoClause} ${whereClause}
        GROUP BY "planSuscripcionId"
      `);

    const planes = await this.prisma.planSuscripcion.findMany({
      where: { id: { in: pagosPorPlan.map(p => p.planSuscripcionId) } },
      select: { id: true, nombre: true },
    });
    const planesMap = new Map(planes.map(p => [p.id, p.nombre]));

    // Por método de pago
    const pagosPorMetodo: { metodoPago: string; total: any; cantidad: bigint }[] =
      await this.prisma.$queryRawUnsafe(`
        SELECT "metodoPago", COALESCE(SUM("monto"), 0) as total, COUNT(*) as cantidad
        FROM "PagoSuscripcion"
        WHERE ${estadoClause} ${whereClause}
        GROUP BY "metodoPago"
      `);

    // Por mes (últimos 12 meses)
    const hace12Meses = new Date();
    hace12Meses.setMonth(hace12Meses.getMonth() - 12);

    const pagosRecientes = await this.prisma.pagoSuscripcion.findMany({
      where: {
        estado: EstadoPagoSuscripcion.COMPLETADO,
        fechaPago: { gte: hace12Meses },
      },
      select: { fechaPago: true, monto: true },
    });

    const mesesMap = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      mesesMap.set(key, 0);
    }

    pagosRecientes.forEach(p => {
      const key = `${p.fechaPago.getFullYear()}-${String(p.fechaPago.getMonth() + 1).padStart(2, '0')}`;
      if (mesesMap.has(key)) {
        mesesMap.set(key, mesesMap.get(key) + Number(p.monto));
      }
    });

    return {
      totalIngresos: Number(totalResult._sum.monto || 0),
      totalPagos: totalResult._count.id,
      porPlan: pagosPorPlan.map(p => ({
        planId: p.planSuscripcionId,
        planNombre: planesMap.get(p.planSuscripcionId) || 'Desconocido',
        total: Number(p.total || 0),
        cantidad: Number(p.cantidad),
      })),
      porMetodo: pagosPorMetodo.map(p => ({
        metodoPago: p.metodoPago,
        total: Number(p.total || 0),
        cantidad: Number(p.cantidad),
      })),
      porMes: Array.from(mesesMap.entries()).map(([mes, total]) => ({ mes, total })),
    };
  }

  // ==========================================
  // NOTIFICACIONES
  // ==========================================

  async enviarAEmpresa(empresaId: string, dto: AdminEnviarNotificacionDto) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    // Obtener todos los usuarios de esta empresa
    const usuarioRoles = await this.prisma.empresaUsuarioRol.findMany({
      where: { empresaId, deletedAt: null, isActive: true },
      select: { usuarioId: true },
    });

    const usuarioIds = [...new Set(usuarioRoles.map(r => r.usuarioId))];
    if (usuarioIds.length === 0) {
      return { enviados: 0, mensaje: 'La empresa no tiene usuarios activos' };
    }

    try {
      await this.notificacionService.enviarAUsuarios(
        usuarioIds,
        dto.titulo,
        dto.mensaje,
        {
          tipo: dto.tipo || TipoNotificacion.SISTEMA,
          empresaId,
          data: { source: 'admin' },
        },
      );
    } catch (error: any) {
      this.logger.warn(`Push falló pero notificación guardada: ${error?.message}`);
    }

    this.logger.log(`Notificación enviada a empresa ${empresa.nombre} (${usuarioIds.length} usuarios)`);

    return {
      enviados: usuarioIds.length,
      empresa: empresa.nombre,
      mensaje: `Notificación enviada a ${usuarioIds.length} usuarios de ${empresa.nombre}`,
    };
  }

  async enviarBroadcast(dto: AdminEnviarNotificacionDto) {
    // Obtener todos los usuarios activos del sistema
    const usuarios = await this.prisma.usuario.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    const usuarioIds = usuarios.map(u => u.id);
    if (usuarioIds.length === 0) {
      return { enviados: 0, mensaje: 'No hay usuarios activos en el sistema' };
    }

    try {
      await this.notificacionService.enviarAUsuarios(
        usuarioIds,
        dto.titulo,
        dto.mensaje,
        {
          tipo: dto.tipo || TipoNotificacion.SISTEMA,
          data: { source: 'admin', broadcast: 'true' },
        },
      );
    } catch (error: any) {
      this.logger.warn(`Push broadcast falló pero notificación guardada: ${error?.message}`);
    }

    this.logger.log(`Broadcast enviado a ${usuarioIds.length} usuarios`);

    return {
      enviados: usuarioIds.length,
      mensaje: `Notificación enviada a ${usuarioIds.length} usuarios`,
    };
  }

  async enviarAUsuarios(dto: AdminEnviarUsuariosDto) {
    if (!dto.usuarioIds || dto.usuarioIds.length === 0) {
      throw new BadRequestException('Debe especificar al menos un usuario');
    }

    try {
      await this.notificacionService.enviarAUsuarios(
        dto.usuarioIds,
        dto.titulo,
        dto.mensaje,
        {
          tipo: dto.tipo || TipoNotificacion.SISTEMA,
          data: { source: 'admin' },
        },
      );
    } catch (error: any) {
      this.logger.warn(`Push a usuarios falló pero notificación guardada: ${error?.message}`);
    }

    this.logger.log(`Notificación enviada a ${dto.usuarioIds.length} usuarios seleccionados`);

    return {
      enviados: dto.usuarioIds.length,
      mensaje: `Notificación enviada a ${dto.usuarioIds.length} usuarios`,
    };
  }

  async getNotificacionesEnviadas(page = 1, pageSize = 20) {
    const where = { tipo: TipoNotificacion.SISTEMA };

    const [items, total] = await Promise.all([
      this.prisma.notificacion.findMany({
        where,
        select: {
          id: true,
          titulo: true,
          cuerpo: true,
          tipo: true,
          data: true,
          creadoEn: true,
          empresaId: true,
          usuario: {
            select: {
              email: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificacion.count({ where }),
    ]);

    return {
      items: items.map(n => ({
        id: n.id,
        titulo: n.titulo,
        cuerpo: n.cuerpo,
        tipo: n.tipo,
        empresaId: n.empresaId,
        destinatario: n.usuario?.persona
          ? `${n.usuario.persona.nombres} ${n.usuario.persona.apellidos}`
          : n.usuario?.email || 'Desconocido',
        creadoEn: n.creadoEn,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ==========================================
  // CONFIGURACIÓN DEL SISTEMA
  // ==========================================

  private static readonly CONFIG_ID = 'SYSTEM_CONFIG';
  private static readonly CONFIG_CACHE_KEY = 'system_config';

  async getConfiguracionSistema() {
    return this.cache.getOrSet(
      AdminService.CONFIG_CACHE_KEY,
      async () => {
        let config = await this.prisma.configuracionSistema.findUnique({
          where: { id: AdminService.CONFIG_ID },
        });

        if (!config) {
          config = await this.prisma.configuracionSistema.create({
            data: { id: AdminService.CONFIG_ID },
          });
        }

        return config;
      },
      600, // 10 min cache
    );
  }

  async updateConfiguracionSistema(data: Record<string, any>) {
    // Filtrar campos válidos del modelo
    const allowedFields = [
      'yapeNumero', 'yapeTitular', 'yapeQrUrl',
      'plinNumero', 'plinTitular', 'plinQrUrl',
      'bancoCuenta', 'bancoCci', 'bancoNombre', 'bancoTitular',
      'diasGracia', 'diasTrialNuevas', 'planDefaultId',
      'modoMantenimiento', 'mensajeMantenimiento',
      'whatsappSoporte', 'emailSoporte', 'mensajeBienvenida',
      'nombreSistema', 'logoUrl',
    ];

    const filteredData: Record<string, any> = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        filteredData[key] = data[key];
      }
    }

    const updated = await this.prisma.configuracionSistema.upsert({
      where: { id: AdminService.CONFIG_ID },
      update: filteredData,
      create: { id: AdminService.CONFIG_ID, ...filteredData },
    });

    // Invalidar cache
    await this.cache.invalidate(AdminService.CONFIG_CACHE_KEY);

    this.logger.log('Configuración del sistema actualizada', { campos: Object.keys(filteredData) });

    return updated;
  }

  async getConfiguracionPublica() {
    const config = await this.getConfiguracionSistema();

    return {
      // Datos de pago (para app cliente)
      yapeNumero: config.yapeNumero,
      yapeTitular: config.yapeTitular,
      yapeQrUrl: config.yapeQrUrl,
      plinNumero: config.plinNumero,
      plinTitular: config.plinTitular,
      plinQrUrl: config.plinQrUrl,
      bancoCuenta: config.bancoCuenta,
      bancoCci: config.bancoCci,
      bancoNombre: config.bancoNombre,
      bancoTitular: config.bancoTitular,
      // Sistema
      modoMantenimiento: config.modoMantenimiento,
      mensajeMantenimiento: config.mensajeMantenimiento,
      whatsappSoporte: config.whatsappSoporte,
      emailSoporte: config.emailSoporte,
      mensajeBienvenida: config.mensajeBienvenida,
      nombreSistema: config.nombreSistema,
      logoUrl: config.logoUrl,
      diasGracia: config.diasGracia,
    };
  }

  // ==========================================
  // MONITOR DEL SISTEMA
  // ==========================================

  private startTime = Date.now();

  async getSystemHealth() {
    const results: Record<string, any> = {};

    // Backend
    results.backend = {
      status: 'online',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      uptimeFormatted: this.formatUptime(Date.now() - this.startTime),
      version: '1.0.0',
      environment: this.configService.get('NODE_ENV', 'development'),
    };

    // Redis
    try {
      const start = Date.now();
      const pong = await this.redisService.ping();
      const pingMs = Date.now() - start;
      const redisClient = this.redisService.getClient();
      const redisInfo = await redisClient.info('memory');
      const usedMemory = redisInfo.match(/used_memory_human:(\S+)/)?.[1] || 'N/A';

      results.redis = {
        status: pong ? 'online' : 'offline',
        pingMs,
        memoryUsed: usedMemory,
      };
    } catch (e) {
      results.redis = { status: 'offline', error: e?.message };
    }

    // Database
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const pingMs = Date.now() - start;
      results.database = { status: 'online', pingMs };
    } catch (e) {
      results.database = { status: 'offline', error: e?.message };
    }

    // Media Processor
    try {
      const mpUrl = this.configService.get('MEDIA_PROCESSOR_URL');
      if (mpUrl) {
        const start = Date.now();
        const response = await fetch(`${mpUrl}/health`);
        const pingMs = Date.now() - start;
        results.mediaProcessor = {
          status: response.ok ? 'online' : 'offline',
          pingMs,
          url: mpUrl,
        };
      } else {
        results.mediaProcessor = { status: 'not_configured' };
      }
    } catch (e) {
      results.mediaProcessor = { status: 'offline', error: e?.message };
    }

    return results;
  }

  async getSystemStats() {
    const ahora = new Date();
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
    const hace7d = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      empresasActivas,
      empresasTotal,
      usuariosTotal,
      usuariosActivos,
      pagosHoy,
      pagosSemana,
      notificacionesHoy,
      sesionesActivas,
      storageTotal,
    ] = await Promise.all([
      this.prisma.empresa.count({ where: { estadoSuscripcion: 'ACTIVA', deletedAt: null } }),
      this.prisma.empresa.count({ where: { deletedAt: null } }),
      this.prisma.usuario.count({ where: { deletedAt: null } }),
      this.prisma.usuario.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.pagoSuscripcion.count({ where: { creadoEn: { gte: new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()) } } }),
      this.prisma.pagoSuscripcion.count({ where: { creadoEn: { gte: hace7d } } }),
      this.prisma.notificacion.count({ where: { creadoEn: { gte: hace24h } } }),
      this.prisma.dispositivoNotificacion.count({ where: { isActive: true } }),
      this.prisma.archivo.aggregate({ _sum: { tamanoBytes: true } }),
    ]);

    // Registros por hora (últimas 24h)
    const empresasPorHora: { hora: string; count: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const desde = new Date(ahora.getTime() - (i + 1) * 60 * 60 * 1000);
      const hasta = new Date(ahora.getTime() - i * 60 * 60 * 1000);
      const count = await this.prisma.empresa.count({
        where: { creadoEn: { gte: desde, lt: hasta }, deletedAt: null },
      });
      empresasPorHora.push({
        hora: `${String(hasta.getHours()).padStart(2, '0')}:00`,
        count,
      });
    }

    return {
      empresas: { activas: empresasActivas, total: empresasTotal },
      usuarios: { activos: usuariosActivos, total: usuariosTotal },
      pagos: { hoy: pagosHoy, semana: pagosSemana },
      notificaciones: { hoy: notificacionesHoy },
      dispositivos: { activos: sesionesActivas },
      storage: {
        totalUsedMB: Math.round(Number(storageTotal._sum.tamanoBytes || 0) / (1024 * 1024)),
      },
      registrosPorHora: empresasPorHora,
    };
  }

  async getSystemLogs(page = 1, pageSize = 50) {
    // Últimas actividades: pagos, cambios de suscripción, registros de empresa
    const [pagosRecientes, empresasRecientes, notificacionesRecientes] = await Promise.all([
      this.prisma.pagoSuscripcion.findMany({
        select: {
          id: true, monto: true, estado: true, metodoPago: true, creadoEn: true,
          empresa: { select: { nombre: true } },
          planSuscripcion: { select: { nombre: true } },
        },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
      this.prisma.empresa.findMany({
        select: { id: true, nombre: true, ruc: true, estadoSuscripcion: true, creadoEn: true },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
      this.prisma.notificacion.findMany({
        where: { tipo: 'SISTEMA' },
        select: {
          id: true, titulo: true, cuerpo: true, creadoEn: true,
          usuario: { select: { email: true } },
        },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
    ]);

    // Combinar y ordenar por fecha
    const logs = [
      ...pagosRecientes.map(p => ({
        tipo: 'PAGO',
        mensaje: `Pago S/ ${Number(p.monto).toFixed(2)} - ${p.empresa?.nombre} - ${p.planSuscripcion?.nombre}`,
        estado: p.estado,
        fecha: p.creadoEn,
      })),
      ...empresasRecientes.map(e => ({
        tipo: 'EMPRESA',
        mensaje: `Empresa registrada: ${e.nombre} (${e.ruc || 'Sin RUC'})`,
        estado: e.estadoSuscripcion,
        fecha: e.creadoEn,
      })),
      ...notificacionesRecientes.map(n => ({
        tipo: 'NOTIFICACION',
        mensaje: `${n.titulo} → ${n.usuario?.email || 'N/A'}`,
        estado: 'ENVIADA',
        fecha: n.creadoEn,
      })),
    ]
      .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
      .slice(0, pageSize);

    return { items: logs, total: logs.length, page, pageSize };
  }

  private formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
