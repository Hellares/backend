import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketplaceUsuarioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ubicación de card: SIEMPRE la sede principal; fallback a geografía de la empresa. */
  private _ubicacionSedePrincipal(empresa: {
    distrito?: string | null; provincia?: string | null; departamento?: string | null;
    sedes?: { direccion?: string | null; distrito?: string | null; provincia?: string | null; departamento?: string | null }[];
  }): string {
    const sede = empresa.sedes?.[0];
    const base = sede
      ? [sede.direccion, sede.distrito, sede.provincia]
      : [empresa.distrito, empresa.provincia, empresa.departamento];
    // La dirección de sede suele incluir ya distrito/provincia en el texto — no repetirlos.
    const parts: string[] = [];
    for (const p of base) {
      if (!p?.trim()) continue;
      const low = p.trim().toLowerCase();
      if (parts.some((x) => x.toLowerCase().includes(low))) continue;
      parts.push(p.trim());
    }
    return parts.join(', ');
  }

  // ─── Favoritos ───

  async toggleFavorito(usuarioId: string, productoId: string) {
    const existente = await this.prisma.favoritoProducto.findUnique({
      where: { usuarioId_productoId: { usuarioId, productoId } },
    });

    if (existente) {
      await this.prisma.favoritoProducto.delete({ where: { id: existente.id } });
      return { favorito: false };
    }

    // Verificar producto existe
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, isActive: true, visibleMarketplace: true },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    await this.prisma.favoritoProducto.create({
      data: { usuarioId, productoId },
    });
    return { favorito: true };
  }

  async listarFavoritos(usuarioId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [favoritos, total] = await Promise.all([
      this.prisma.favoritoProducto.findMany({
        where: { usuarioId },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          productoId: true,
          creadoEn: true,
          producto: {
            select: {
              id: true,
              nombre: true,
              descripcion: true,
              isActive: true,
              visibleMarketplace: true,
              empresa: {
                select: { id: true, nombre: true, logo: true, subdominio: true, telefono: true,
                  departamento: true, provincia: true, distrito: true,
                  configuracionDocumentos: { select: { nombreComercial: true } },
                  sedes: {
                    where: { isActive: true, deletedAt: null },
                    orderBy: { esPrincipal: 'desc' as const },
                    take: 1,
                    select: { direccion: true, distrito: true, provincia: true, departamento: true },
                  } },
              },
              stocksPorSede: {
                where: { precioConfigurado: true },
                select: { precio: true, precioOferta: true, enOferta: true, stockActual: true },
                take: 1,
                orderBy: { precio: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.favoritoProducto.count({ where: { usuarioId } }),
    ]);

    // Obtener imágenes
    const productoIds = favoritos.map((f) => f.productoId);
    const imagenes = productoIds.length > 0
      ? await this.prisma.archivo.findMany({
          where: { entidadTipo: 'PRODUCTO', entidadId: { in: productoIds }, tipoArchivo: 'IMAGEN', isActive: true, deletedAt: null },
          select: { entidadId: true, urlThumbnail: true, url: true },
          orderBy: { orden: 'asc' },
        })
      : [];

    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    const data = favoritos
      .filter((f) => f.producto.isActive && f.producto.visibleMarketplace)
      .map((f) => {
        const stock = f.producto.stocksPorSede[0];
        return {
          id: f.producto.id,
          nombre: f.producto.nombre,
          descripcion: f.producto.descripcion?.substring(0, 120) || null,
          precio: stock?.precio ? Number(stock.precio) : null,
          precioOferta: stock?.enOferta && stock?.precioOferta ? Number(stock.precioOferta) : null,
          enOferta: stock?.enOferta ?? false,
          hayStock: stock?.stockActual ? stock.stockActual > 0 : false,
          imagen: imagenMap.get(f.productoId) ?? null,
          empresa: {
            id: f.producto.empresa.id,
            nombre: f.producto.empresa.configuracionDocumentos?.nombreComercial || f.producto.empresa.nombre,
            logo: f.producto.empresa.logo,
            subdominio: f.producto.empresa.subdominio,
            telefono: f.producto.empresa.telefono,
            direccion: f.producto.empresa.sedes?.[0]?.direccion ?? null,
            ubicacion: this._ubicacionSedePrincipal(f.producto.empresa),
          },
          favoritoDesde: f.creadoEn,
        };
      });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async esFavorito(usuarioId: string, productoId: string) {
    const existe = await this.prisma.favoritoProducto.findUnique({
      where: { usuarioId_productoId: { usuarioId, productoId } },
      select: { id: true },
    });
    return { favorito: !!existe };
  }

  async getFavoritosIds(usuarioId: string) {
    const favoritos = await this.prisma.favoritoProducto.findMany({
      where: { usuarioId },
      select: { productoId: true },
    });
    return favoritos.map((f) => f.productoId);
  }

  // ─── Productos vistos ───

  async registrarVisto(usuarioId: string, productoId: string) {
    await this.prisma.productoVisto.upsert({
      where: { usuarioId_productoId: { usuarioId, productoId } },
      update: { vistoEn: new Date() },
      create: { usuarioId, productoId },
    });

    // Mantener máximo 50 registros por usuario
    const total = await this.prisma.productoVisto.count({ where: { usuarioId } });
    if (total > 50) {
      const antiguos = await this.prisma.productoVisto.findMany({
        where: { usuarioId },
        orderBy: { vistoEn: 'asc' },
        take: total - 50,
        select: { id: true },
      });
      await this.prisma.productoVisto.deleteMany({
        where: { id: { in: antiguos.map((a) => a.id) } },
      });
    }

    return { registrado: true };
  }

  async listarVistos(usuarioId: string, limit = 20) {
    const vistos = await this.prisma.productoVisto.findMany({
      where: { usuarioId },
      orderBy: { vistoEn: 'desc' },
      take: limit,
      select: {
        productoId: true,
        vistoEn: true,
        producto: {
          select: {
            id: true,
            nombre: true,
            isActive: true,
            visibleMarketplace: true,
            empresa: {
              select: { id: true, nombre: true, logo: true, subdominio: true, telefono: true,
                departamento: true, provincia: true, distrito: true,
                configuracionDocumentos: { select: { nombreComercial: true } },
                sedes: {
                  where: { isActive: true, deletedAt: null },
                  orderBy: { esPrincipal: 'desc' as const },
                  take: 1,
                  select: { direccion: true, distrito: true, provincia: true, departamento: true },
                } },
            },
            stocksPorSede: {
              where: { precioConfigurado: true },
              select: { precio: true, precioOferta: true, enOferta: true, stockActual: true },
              take: 1,
              orderBy: { precio: 'asc' },
            },
          },
        },
      },
    });

    const productoIds = vistos.map((v) => v.productoId);
    const imagenes = productoIds.length > 0
      ? await this.prisma.archivo.findMany({
          where: { entidadTipo: 'PRODUCTO', entidadId: { in: productoIds }, tipoArchivo: 'IMAGEN', isActive: true, deletedAt: null },
          select: { entidadId: true, urlThumbnail: true, url: true },
          orderBy: { orden: 'asc' },
        })
      : [];

    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    return vistos
      .filter((v) => v.producto.isActive && v.producto.visibleMarketplace)
      .map((v) => {
        const stock = v.producto.stocksPorSede[0];
        return {
          id: v.producto.id,
          nombre: v.producto.nombre,
          precio: stock?.precio ? Number(stock.precio) : null,
          precioOferta: stock?.enOferta && stock?.precioOferta ? Number(stock.precioOferta) : null,
          enOferta: stock?.enOferta ?? false,
          hayStock: stock?.stockActual ? stock.stockActual > 0 : false,
          imagen: imagenMap.get(v.productoId) ?? null,
          empresa: {
            id: v.producto.empresa.id,
            nombre: v.producto.empresa.configuracionDocumentos?.nombreComercial || v.producto.empresa.nombre,
            logo: v.producto.empresa.logo,
            subdominio: v.producto.empresa.subdominio,
            telefono: v.producto.empresa.telefono,
            direccion: v.producto.empresa.sedes?.[0]?.direccion ?? null,
            ubicacion: this._ubicacionSedePrincipal(v.producto.empresa),
          },
          vistoEn: v.vistoEn,
        };
      });
  }
}
