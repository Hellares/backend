import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CaracteristicaPremium, Prisma, Rol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import {
  ActualizarBannerDto,
  ActualizarLottieFondoDto,
  AvisoPlataformaDto,
  CrearLottieFondoDto,
} from './dto/banner-marketplace.dto';

/**
 * Banner promocional de empresas en el home del marketplace (slider 60px).
 * Público SOLO para empresas con la característica BANNER_MARKETPLACE vigente
 * (gate en runtime: si el plan vence, el banner desaparece solo, sin data-fix).
 */
@Injectable()
export class BannerMarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caracteristicaEmpresa: CaracteristicaEmpresaService,
  ) {}

  /** Banners visibles al público (slider del home del marketplace). */
  async bannersPublicos() {
    const now = new Date();
    // Avisos del dueño de la plataforma vigentes (van PRIMERO, sin shuffle).
    const avisos = await this.prisma.bannerPlataforma.findMany({
      where: {
        isActive: true,
        OR: [{ vigenciaDesde: null }, { vigenciaDesde: { lte: now } }],
        AND: [{ OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: now } }] }],
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      select: {
        id: true,
        titulo: true,
        texto: true,
        colorFondo: true,
        colorTexto: true,
        colorBrillo: true,
        logoUrl: true,
        link: true,
        lottieFondo: { select: { url: true, config: true } },
      },
    });

    const banners = await this.prisma.bannerMarketplace.findMany({
      where: {
        isActive: true,
        empresa: {
          isActive: true,
          deletedAt: null,
          visibleEnMarketplace: true,
          caracteristicas: {
            some: {
              caracteristica: CaracteristicaPremium.BANNER_MARKETPLACE,
              habilitado: true,
              OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: new Date() } }],
            },
          },
        },
      },
      select: {
        id: true,
        texto: true,
        colorFondo: true,
        colorTexto: true,
        colorBrillo: true,
        lottieFondo: { select: { url: true, config: true } },
        empresa: {
          select: {
            id: true,
            nombre: true,
            logo: true,
            subdominio: true,
            configuracionDocumentos: { select: { nombreComercial: true } },
          },
        },
      },
    });

    const data = banners.map((b) => ({
      id: b.id,
      texto: b.texto,
      colorFondo: b.colorFondo,
      colorTexto: b.colorTexto,
      colorBrillo: b.colorBrillo,
      lottieUrl: b.lottieFondo?.url ?? null,
      lottieConfig: b.lottieFondo?.config ?? null,
      empresaId: b.empresa.id,
      nombreEmpresa:
        b.empresa.configuracionDocumentos?.nombreComercial || b.empresa.nombre,
      logo: b.empresa.logo,
      subdominio: b.empresa.subdominio,
    }));

    // Orden aleatorio por request: ninguna empresa "gana" siempre la 1ª posición.
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]];
    }

    // Avisos de plataforma primero, con el mismo shape que los de empresa.
    const avisosData = avisos.map((a) => ({
      id: a.id,
      texto: a.texto,
      colorFondo: a.colorFondo,
      colorTexto: a.colorTexto,
      colorBrillo: a.colorBrillo,
      lottieUrl: a.lottieFondo?.url ?? null,
      lottieConfig: a.lottieFondo?.config ?? null,
      empresaId: null as string | null,
      nombreEmpresa: a.titulo || 'Syncronize',
      logo: a.logoUrl,
      subdominio: null as string | null,
      link: a.link,
    }));

    return [...avisosData, ...data];
  }

  /** Día calendario actual en zona Lima (UTC-5, sin DST) como Date UTC-00:00. */
  private _hoyLima(): Date {
    const lima = new Date(Date.now() - 5 * 3600 * 1000);
    return new Date(Date.UTC(
      lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(),
    ));
  }

  /**
   * Registra una impresión o tap del banner (público, fire-and-forget desde
   * el app). Nunca lanza: las métricas jamás deben romper el marketplace.
   */
  async registrarEvento(bannerId: string, tipo: 'IMPRESION' | 'TAP') {
    try {
      const fecha = this._hoyLima();
      await this.prisma.bannerMetricaDiaria.upsert({
        where: { bannerId_fecha: { bannerId, fecha } },
        create: {
          bannerId,
          fecha,
          impresiones: tipo === 'IMPRESION' ? 1 : 0,
          taps: tipo === 'TAP' ? 1 : 0,
        },
        update: tipo === 'IMPRESION'
          ? { impresiones: { increment: 1 } }
          : { taps: { increment: 1 } },
      });
      return { ok: true };
    } catch {
      // bannerId inexistente (FK) o carrera del upsert: se ignora.
      return { ok: false };
    }
  }

  /** Suma de métricas del banner en el mes calendario actual (zona Lima). */
  private async _metricasMes(bannerId: string) {
    const hoy = this._hoyLima();
    const inicioMes = new Date(Date.UTC(
      hoy.getUTCFullYear(), hoy.getUTCMonth(), 1,
    ));
    const agg = await this.prisma.bannerMetricaDiaria.aggregate({
      where: { bannerId, fecha: { gte: inicioMes } },
      _sum: { impresiones: true, taps: true },
    });
    return {
      impresiones: agg._sum.impresiones ?? 0,
      taps: agg._sum.taps ?? 0,
    };
  }

  /** Catálogo de fondos Lottie activos (selector en la config de la empresa). */
  async lottieFondos() {
    return this.prisma.lottieFondo.findMany({
      where: { isActive: true },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      select: { id: true, nombre: true, url: true, config: true },
    });
  }

  // ===========================================================================
  // Gestión por la empresa (panel admin de la empresa)
  // ===========================================================================

  /** Config del banner de la empresa + si tiene la característica vigente. */
  async getBanner(empresaId: string, userId: string) {
    await this.verificarAdmin(empresaId, userId);
    const [habilitado, banner, empresa] = await Promise.all([
      this.caracteristicaEmpresa.estaHabilitada(
        empresaId,
        CaracteristicaPremium.BANNER_MARKETPLACE,
      ),
      this.prisma.bannerMarketplace.findUnique({
        where: { empresaId },
        include: {
          lottieFondo: { select: { id: true, nombre: true, url: true, config: true } },
        },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          nombre: true,
          logo: true,
          configuracionDocumentos: { select: { nombreComercial: true } },
        },
      }),
    ]);
    return {
      habilitado,
      banner,
      // Para el preview: mismo nombre que verá el público en el slider.
      nombreEmpresa:
        empresa?.configuracionDocumentos?.nombreComercial || empresa?.nombre || '',
      logo: empresa?.logo ?? null,
      // Publicidad: rendimiento del mes calendario actual (zona Lima).
      metricasMes: banner ? await this._metricasMes(banner.id) : null,
    };
  }

  /** Crea/actualiza el banner de la empresa (requiere característica vigente). */
  async upsertBanner(empresaId: string, userId: string, dto: ActualizarBannerDto) {
    await this.verificarAdmin(empresaId, userId);
    const habilitado = await this.caracteristicaEmpresa.estaHabilitada(
      empresaId,
      CaracteristicaPremium.BANNER_MARKETPLACE,
    );
    if (!habilitado) {
      throw new ForbiddenException(
        'Tu plan no incluye el banner del marketplace',
      );
    }
    if (dto.lottieFondoId) {
      const lottie = await this.prisma.lottieFondo.findFirst({
        where: { id: dto.lottieFondoId, isActive: true },
        select: { id: true },
      });
      if (!lottie) throw new BadRequestException('Fondo animado no válido');
    }

    return this.prisma.bannerMarketplace.upsert({
      where: { empresaId },
      create: {
        empresaId,
        texto: dto.texto.trim(),
        ...(dto.colorFondo && { colorFondo: dto.colorFondo }),
        colorTexto: dto.colorTexto ?? null,
        colorBrillo: dto.colorBrillo ?? null,
        lottieFondoId: dto.lottieFondoId ?? null,
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      update: {
        texto: dto.texto.trim(),
        ...(dto.colorFondo && { colorFondo: dto.colorFondo }),
        ...(dto.colorTexto !== undefined && { colorTexto: dto.colorTexto }),
        ...(dto.colorBrillo !== undefined && { colorBrillo: dto.colorBrillo }),
        ...(dto.lottieFondoId !== undefined && {
          lottieFondoId: dto.lottieFondoId,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        lottieFondo: { select: { id: true, nombre: true, url: true, config: true } },
      },
    });
  }

  // ===========================================================================
  // Avisos de plataforma (solo super admin — banners del dueño del app)
  // ===========================================================================

  async adminListarAvisos() {
    return this.prisma.bannerPlataforma.findMany({
      orderBy: [{ orden: 'asc' }, { creadoEn: 'desc' }],
      include: {
        lottieFondo: { select: { id: true, nombre: true, url: true, config: true } },
      },
    });
  }

  private _datosAviso(dto: AvisoPlataformaDto) {
    return {
      texto: dto.texto.trim(),
      titulo: dto.titulo?.trim() || null,
      ...(dto.colorFondo && { colorFondo: dto.colorFondo }),
      colorTexto: dto.colorTexto ?? null,
      colorBrillo: dto.colorBrillo ?? null,
      lottieFondoId: dto.lottieFondoId ?? null,
      logoUrl: dto.logoUrl?.trim() || null,
      link: dto.link?.trim() || null,
      vigenciaDesde: dto.vigenciaDesde ? new Date(dto.vigenciaDesde) : null,
      vigenciaHasta: dto.vigenciaHasta ? new Date(dto.vigenciaHasta) : null,
      ...(dto.orden !== undefined && { orden: dto.orden }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }

  async adminCrearAviso(dto: AvisoPlataformaDto) {
    return this.prisma.bannerPlataforma.create({ data: this._datosAviso(dto) });
  }

  async adminActualizarAviso(id: string, dto: AvisoPlataformaDto) {
    return this.prisma.bannerPlataforma.update({
      where: { id },
      data: this._datosAviso(dto),
    });
  }

  async adminEliminarAviso(id: string) {
    await this.prisma.bannerPlataforma.delete({ where: { id } });
    return { ok: true };
  }

  // ===========================================================================
  // Catálogo LottieFondo (solo super admin de la plataforma)
  // ===========================================================================

  async adminListarLotties() {
    return this.prisma.lottieFondo.findMany({
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });
  }

  async adminCrearLottie(dto: CrearLottieFondoDto) {
    return this.prisma.lottieFondo.create({
      data: {
        nombre: dto.nombre.trim(),
        url: dto.url.trim(),
        ...(dto.orden !== undefined && { orden: dto.orden }),
        ...(dto.config != null && {
          config: dto.config as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async adminActualizarLottie(id: string, dto: ActualizarLottieFondoDto) {
    return this.prisma.lottieFondo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.url !== undefined && { url: dto.url.trim() }),
        ...(dto.orden !== undefined && { orden: dto.orden }),
        ...(dto.config !== undefined && {
          config:
            dto.config === null
              ? Prisma.DbNull
              : (dto.config as Prisma.InputJsonValue),
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /** Borrado real: los banners que lo usaban quedan con lottieFondoId=null (FK SetNull). */
  async adminEliminarLottie(id: string) {
    await this.prisma.lottieFondo.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Verifica que el usuario sea administrador de la empresa. Mismo criterio que
   * IntegracionYapeService.verificarAdmin (SUPER_ADMIN / EMPRESA_ADMIN activos).
   */
  private async verificarAdmin(empresaId: string, userId: string): Promise<void> {
    const userRole = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: { in: [Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN] },
      },
    });
    if (!userRole) {
      throw new ForbiddenException(
        'No tienes permisos para gestionar el banner de esta empresa',
      );
    }
  }
}
