import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CaracteristicaPremium, Rol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import {
  ActualizarBannerDto,
  ActualizarLottieFondoDto,
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
        lottieFondo: { select: { url: true } },
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
      lottieUrl: b.lottieFondo?.url ?? null,
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
    return data;
  }

  /** Catálogo de fondos Lottie activos (selector en la config de la empresa). */
  async lottieFondos() {
    return this.prisma.lottieFondo.findMany({
      where: { isActive: true },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      select: { id: true, nombre: true, url: true },
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
          lottieFondo: { select: { id: true, nombre: true, url: true } },
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
        lottieFondoId: dto.lottieFondoId ?? null,
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      update: {
        texto: dto.texto.trim(),
        ...(dto.colorFondo && { colorFondo: dto.colorFondo }),
        ...(dto.lottieFondoId !== undefined && {
          lottieFondoId: dto.lottieFondoId,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        lottieFondo: { select: { id: true, nombre: true, url: true } },
      },
    });
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
