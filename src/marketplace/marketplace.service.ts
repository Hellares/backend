import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  condicionesPorAtributo,
  sumarAlAnd,
} from '../producto/utils/filtro-atributos.util';

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Buscar productos en todo el marketplace (global)
   */
  /**
   * Calcular distancia entre dos puntos (Haversine) en km
   */
  private calcularDistancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async searchProductos(query: {
    search?: string;
    categoriaId?: string;
    marcaId?: string;
    precioMin?: number;
    precioMax?: number;
    departamento?: string;
    /** Valores de atributo en formato `clave:valor`. */
    atributos?: string[];
    orden?: string;
    lat?: number;
    lng?: number;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const where: any = {
      visibleMarketplace: true,
      isActive: true,
      deletedAt: null,
      // Insumos / materia prima jamás aparecen al público.
      esInsumo: false,
      empresa: { isActive: true, deletedAt: null, visibleEnMarketplace: true },
    };

    if (query.search) {
      where.OR = [
        { nombre: { contains: query.search, mode: 'insensitive' } },
        { descripcion: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.categoriaId) {
      where.empresaCategoria = { categoriaMaestraId: query.categoriaId };
    }

    if (query.marcaId) {
      where.empresaMarca = { marcaMaestraId: query.marcaId };
    }

    if (query.departamento) {
      where.empresa = { ...where.empresa, departamento: query.departamento };
    }

    if (query.precioMin || query.precioMax) {
      where.stocksPorSede = {
        some: {
          precioConfigurado: true,
          ...(query.precioMin && { precio: { gte: query.precioMin } }),
          ...(query.precioMax && { precio: { lte: query.precioMax } }),
        },
      };
    }

    // Filtro por valor de atributo. Misma semántica y mismo util que el
    // catálogo de la empresa: Y entre claves distintas, O entre los valores de
    // una misma, mirando el producto base Y sus variantes.
    //
    // 🔴 Va al AND y no pisa nada: `where.OR` de más arriba es la búsqueda por
    // texto, y son cosas distintas que tienen que convivir.
    sumarAlAnd(where, condicionesPorAtributo(query.atributos));

    // Orden base (DB): destacados primero, luego recientes. El orden por PRECIO
    // no se resuelve a nivel Prisma (el precio vive en la relación
    // `stocksPorSede`), se maneja aparte más abajo.
    const ordenarPorPrecio =
      query.orden === 'precio_asc' || query.orden === 'precio_desc';
    let orderBy: any = [{ destacado: 'desc' }, { creadoEn: 'desc' }];
    if (query.orden === 'recientes') orderBy = { creadoEn: 'desc' };

    // Include compartido por las dos rutas de carga (def en `_includeMarketplace`).
    const includeProducto = this._includeMarketplace;

    let productos: any[];
    let total: number;

    if (ordenarPorPrecio) {
      // Precio representativo del producto = mínimo precio configurado entre sus
      // sedes. Como Prisma no puede `orderBy` una relación, traemos id+precio de
      // TODO el set filtrado, ordenamos/paginamos en memoria e hidratamos solo la
      // página. (A futuro, para catálogos grandes, denormalizar un
      // `precioReferencia` en Producto e indexarlo.)
      const livianos = await this.prisma.producto.findMany({
        where,
        select: {
          id: true,
          stocksPorSede: {
            where: { precioConfigurado: true },
            select: { precio: true },
            orderBy: { precio: 'asc' },
            take: 1,
          },
        },
      });
      total = livianos.length;
      const dir = query.orden === 'precio_asc' ? 1 : -1;
      const pageIds = livianos
        .map((p) => ({
          id: p.id,
          precio:
            p.stocksPorSede[0]?.precio != null
              ? Number(p.stocksPorSede[0].precio)
              : null,
        }))
        .sort((a, b) => {
          // Sin precio configurado → siempre al final, en ambos sentidos.
          if (a.precio == null && b.precio == null) return 0;
          if (a.precio == null) return 1;
          if (b.precio == null) return -1;
          return (a.precio - b.precio) * dir;
        })
        .slice(skip, skip + limit)
        .map((x) => x.id);

      const rows = pageIds.length
        ? await this.prisma.producto.findMany({
            where: { id: { in: pageIds } },
            include: includeProducto,
          })
        : [];
      // `findMany` con `in` no garantiza el orden → reordenar según pageIds.
      const byId = new Map(rows.map((r) => [r.id, r]));
      productos = pageIds
        .map((id) => byId.get(id))
        .filter((p): p is (typeof rows)[number] => !!p);
    } else {
      [productos, total] = await Promise.all([
        this.prisma.producto.findMany({
          where,
          include: includeProducto,
          orderBy,
          skip,
          take: limit,
        }),
        this.prisma.producto.count({ where }),
      ]);
    }

    const userLat = query.lat;
    const userLng = query.lng;
    let data = await this._mapearProductos(productos, userLat, userLng);

    // Si el usuario tiene ubicación, priorizar productos cercanos (20 km).
    // Excepción: si pidió orden explícito por precio, se respeta ese orden.
    if (userLat && userLng && !ordenarPorPrecio) {
      const RADIO_CERCANO = 20; // km
      data = data.sort((a, b) => {
        const aCercano = a.distancia !== null && a.distancia <= RADIO_CERCANO;
        const bCercano = b.distancia !== null && b.distancia <= RADIO_CERCANO;

        // Primero los cercanos (dentro de 20 km)
        if (aCercano && !bCercano) return -1;
        if (!aCercano && bCercano) return 1;

        // Dentro del mismo grupo, ordenar por distancia
        if (aCercano && bCercano) {
          return a.distancia - b.distancia;
        }

        // Los lejanos mantienen el orden original (destacados + recientes)
        return 0;
      });
    }

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Ubicación que ve el cliente en la card: SIEMPRE la de la sede principal
   * (dirección, distrito, provincia); si la empresa no tiene sedes, cae a la
   * geografía de la empresa.
   */
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

  /** Include estándar para mapear un producto al shape de card del marketplace. */
  private get _includeMarketplace(): Prisma.ProductoInclude {
    return {
      empresaCategoria: {
        include: {
          categoriaMaestra: { select: { id: true, nombre: true } },
        },
      },
      empresaMarca: {
        include: {
          marcaMaestra: { select: { id: true, nombre: true } },
        },
      },
      empresa: {
        select: {
          id: true, nombre: true, logo: true, subdominio: true,
          departamento: true, provincia: true, distrito: true, telefono: true,
          // Nombre comercial (marca que ve el cliente) — misma fuente que los tickets.
          configuracionDocumentos: { select: { nombreComercial: true } },
          // Dirección de la SEDE PRINCIPAL: es la que se muestra en la card.
          sedes: {
            where: { isActive: true, deletedAt: null },
            orderBy: { esPrincipal: 'desc' as const },
            take: 1,
            select: { direccion: true, distrito: true, provincia: true, departamento: true },
          },
        },
      },
      stocksPorSede: {
        where: { precioConfigurado: true },
        select: {
          precio: true, precioOferta: true, enOferta: true, stockActual: true,
          fechaInicioOferta: true, fechaFinOferta: true,
          sede: { select: { nombre: true, coordenadas: true } },
        },
        // Traemos TODAS las sedes con precio; la elección la hace
        // _seleccionarStock (oferta-aware). El orderBy es solo un desempate.
        orderBy: { precio: 'asc' },
      },
      // Productos con variantes: el precio/stock vive en las VARIANTES (stock con
      // varianteId, no en el base). Traemos sus stocks para calcular el "desde".
      variantes: {
        where: { isActive: true, deletedAt: null },
        select: {
          id: true,
          stocksPorSede: {
            where: { precioConfigurado: true },
            select: {
              precio: true, precioOferta: true, enOferta: true, stockActual: true,
              fechaInicioOferta: true, fechaFinOferta: true,
              sede: { select: { coordenadas: true } },
            },
            orderBy: { precio: 'asc' },
          },
        },
      },
    };
  }

  /** ¿La oferta del stock está vigente (flag + precio + dentro de fechas)? */
  private _ofertaVigente(stock: any): boolean {
    if (!stock?.enOferta || !stock?.precioOferta) return false;
    const ahora = new Date();
    const inicio = stock.fechaInicioOferta ? new Date(stock.fechaInicioOferta) : null;
    const fin = stock.fechaFinOferta ? new Date(stock.fechaFinOferta) : null;
    if (inicio && fin) return ahora >= inicio && ahora <= fin;
    if (inicio) return ahora >= inicio;
    if (fin) return ahora <= fin;
    return true;
  }

  /** Precio que efectivamente paga el comprador: oferta vigente si la hay, si no el base. */
  private _precioEfectivo(stock: any): number {
    const base = Number(stock?.precio ?? Infinity);
    if (this._ofertaVigente(stock)) {
      const of = Number(stock.precioOferta);
      return Number.isFinite(of) ? of : base;
    }
    return base;
  }

  /**
   * Entre los stocks de las sedes elige el que conviene mostrar en el
   * marketplace: el de MENOR precio efectivo. Así se prioriza la oferta cuando
   * es el mejor precio, sin mostrar una "oferta" más cara que otra sede sin
   * promo (regla honesta). Compartido por listado y detalle → coinciden.
   */
  private _seleccionarStock(stocks: any[]): any | undefined {
    if (!stocks || stocks.length === 0) return undefined;
    return stocks.reduce((mejor, s) =>
      this._precioEfectivo(s) < this._precioEfectivo(mejor) ? s : mejor,
    );
  }

  /** Normaliza los precios por nivel (por mayor) para el marketplace. */
  private _mapNiveles(arr: any[]): any[] {
    return (arr ?? []).map((n) => ({
      nombre: n.nombre,
      cantidadMinima: n.cantidadMinima,
      cantidadMaxima: n.cantidadMaxima,
      tipoPrecio: n.tipoPrecio,
      precio: n.precio != null ? Number(n.precio) : null,
      porcentajeDesc: n.porcentajeDesc != null ? Number(n.porcentajeDesc) : null,
      descripcion: n.descripcion ?? null,
    }));
  }

  /**
   * Hidrata productos crudos (cargados con `_includeMarketplace`) al shape de
   * card del marketplace: imagen principal, rating, oferta vigente y distancia.
   * Compartido por el listado y por las secciones del home.
   */
  private async _mapearProductos(
    productos: any[],
    userLat?: number,
    userLng?: number,
  ) {
    const productoIds = productos.map((p) => p.id);
    if (productoIds.length === 0) return [];

    const imagenes = await this.prisma.archivo.findMany({
      where: {
        entidadTipo: 'PRODUCTO',
        entidadId: { in: productoIds },
        tipoArchivo: 'IMAGEN',
        isActive: true,
        deletedAt: null,
      },
      select: { entidadId: true, url: true, urlThumbnail: true, orden: true, ancho: true, alto: true },
      orderBy: { orden: 'asc' },
    });
    // La imagen principal se guarda con su proporción real (ancho/alto) para que
    // las cards del marketplace puedan escalonarse tipo Temu (masonry).
    type ImgInfo = { url: string; ancho: number | null; alto: number | null };
    const imagenMap = new Map<string, ImgInfo>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, {
          url: img.urlThumbnail || img.url,
          ancho: img.ancho ?? null,
          alto: img.alto ?? null,
        });
      }
    }

    // Fallback: productos SIN imagen base pero con variantes → usar la primera
    // imagen de una variante (las imágenes viven en las variantes).
    const sinImagen = productos.filter((p: any) => !imagenMap.has(p.id) && (p.variantes?.length ?? 0) > 0);
    if (sinImagen.length > 0) {
      const varIds = sinImagen.flatMap((p: any) => (p.variantes ?? []).map((v: any) => v.id));
      const varImgs = await this.prisma.archivo.findMany({
        where: {
          entidadTipo: 'PRODUCTO_VARIANTE',
          entidadId: { in: varIds },
          tipoArchivo: 'IMAGEN',
          isActive: true,
          deletedAt: null,
        },
        select: { entidadId: true, url: true, urlThumbnail: true, ancho: true, alto: true },
        orderBy: { orden: 'asc' },
      });
      const imgPorVariante = new Map<string, ImgInfo>();
      for (const im of varImgs) {
        if (im.entidadId && !imgPorVariante.has(im.entidadId)) {
          imgPorVariante.set(im.entidadId, {
            url: im.urlThumbnail || im.url,
            ancho: im.ancho ?? null,
            alto: im.alto ?? null,
          });
        }
      }
      for (const p of sinImagen) {
        for (const v of p.variantes ?? []) {
          const im = imgPorVariante.get(v.id);
          if (im) { imagenMap.set(p.id, im); break; }
        }
      }
    }

    const opiniones = await this.prisma.opinionProducto.groupBy({
      by: ['productoId'],
      where: { productoId: { in: productoIds } },
      _avg: { calificacion: true },
      _count: true,
    });
    const opinionMap = new Map<string, { promedio: number; total: number }>();
    for (const o of opiniones) {
      opinionMap.set(o.productoId, {
        promedio: Math.round((o._avg.calificacion ?? 0) * 10) / 10,
        total: o._count,
      });
    }

    // Vendidos (prueba social): suma de VentaDetalle no anulada/borrador. Las
    // ventas de variantes van por varianteId, así que sumamos base + variantes
    // y se atribuyen al producto padre.
    const allVariantIds = productos.flatMap((p: any) => (p.variantes ?? []).map((v: any) => v.id));
    const varToProd = new Map<string, string>();
    for (const p of productos) {
      for (const v of p.variantes ?? []) varToProd.set(v.id, p.id);
    }
    const [ventasBase, ventasVar] = await Promise.all([
      this.prisma.ventaDetalle.groupBy({
        by: ['productoId'],
        where: { productoId: { in: productoIds }, venta: { estado: { notIn: ['BORRADOR', 'ANULADA'] } } },
        _sum: { cantidad: true },
      }),
      allVariantIds.length
        ? this.prisma.ventaDetalle.groupBy({
            by: ['varianteId'],
            where: { varianteId: { in: allVariantIds }, venta: { estado: { notIn: ['BORRADOR', 'ANULADA'] } } },
            _sum: { cantidad: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const vendidosMap = new Map<string, number>();
    for (const v of ventasBase) {
      if (v.productoId) vendidosMap.set(v.productoId, (vendidosMap.get(v.productoId) ?? 0) + Number(v._sum.cantidad ?? 0));
    }
    for (const v of ventasVar) {
      const pid = v.varianteId ? varToProd.get(v.varianteId) : null;
      if (pid) vendidosMap.set(pid, (vendidosMap.get(pid) ?? 0) + Number(v._sum.cantidad ?? 0));
    }

    return productos.map((p: any) => {
      // Pool de stocks: base + los de todas las variantes (productos con
      // variantes tienen el precio/stock en las variantes). El "desde" y la
      // oferta salen del de menor precio efectivo.
      const variantStocks = (p.variantes ?? []).flatMap((v: any) => v.stocksPorSede ?? []);
      const allStocks = [...(p.stocksPorSede ?? []), ...variantStocks];
      const stock = this._seleccionarStock(allStocks);
      const tieneVariantes = (p.variantes?.length ?? 0) > 0;
      const coordenadas = stock?.sede?.coordenadas as any;
      let distancia: number | null = null;

      const coordLng = coordenadas?.lng ?? coordenadas?.lon;
      if (userLat && userLng && coordenadas?.lat && coordLng) {
        distancia = Math.round(
          this.calcularDistancia(userLat, userLng, coordenadas.lat, coordLng) * 10,
        ) / 10;
      }

      const ofertaActiva = this._ofertaVigente(stock);

      return {
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcion?.substring(0, 120) || null,
        categoria: p.empresaCategoria?.nombrePersonalizado
          || p.empresaCategoria?.categoriaMaestra?.nombre || null,
        marca: p.empresaMarca?.nombrePersonalizado
          || p.empresaMarca?.marcaMaestra?.nombre || null,
        precio: stock?.precio ? Number(stock.precio) : null,
        precioOferta: ofertaActiva && stock?.precioOferta ? Number(stock.precioOferta) : null,
        enOferta: ofertaActiva,
        ofertaSede: ofertaActiva ? (stock?.sede?.nombre ?? null) : null,
        ofertaFin: ofertaActiva ? (stock?.fechaFinOferta ?? null) : null,
        hayStock: allStocks.some((s: any) => (s.stockActual ?? 0) > 0),
        tieneVariantes,
        imagen: imagenMap.get(p.id)?.url ?? null,
        imagenAncho: imagenMap.get(p.id)?.ancho ?? null,
        imagenAlto: imagenMap.get(p.id)?.alto ?? null,
        calificacion: opinionMap.get(p.id)?.promedio ?? null,
        totalOpiniones: opinionMap.get(p.id)?.total ?? 0,
        vendidos: vendidosMap.get(p.id) ?? 0,
        distancia,
        coordenadas: coordenadas
          ? { lat: coordenadas.lat, lng: coordenadas.lng ?? coordenadas.lon }
          : null,
        destacado: p.destacado,
        creadoEn: p.creadoEn,
        empresa: {
          id: p.empresa.id,
          nombre: p.empresa.configuracionDocumentos?.nombreComercial || p.empresa.nombre,
          logo: p.empresa.logo,
          subdominio: p.empresa.subdominio,
          telefono: p.empresa.telefono,
          direccion: p.empresa.sedes?.[0]?.direccion ?? null,
          ubicacion: this._ubicacionSedePrincipal(p.empresa),
        },
      };
    });
  }

  /**
   * Reputación agregada por empresa: promedio y total de opiniones de TODOS
   * sus productos (OpinionProducto ya guarda empresaId). Devuelve un Map para
   * hidratar listados/perfiles sin N+1.
   */
  private async _reputacionPorEmpresa(empresaIds: string[]) {
    const map = new Map<string, { promedio: number; totalOpiniones: number }>();
    if (empresaIds.length === 0) return map;
    const agg = await this.prisma.opinionProducto.groupBy({
      by: ['empresaId'],
      where: { empresaId: { in: empresaIds } },
      _avg: { calificacion: true },
      _count: true,
    });
    for (const o of agg) {
      map.set(o.empresaId, {
        promedio: Math.round((o._avg.calificacion ?? 0) * 10) / 10,
        totalOpiniones: o._count,
      });
    }
    return map;
  }

  /**
   * Recomendados por historial de navegación (content-based por categoría).
   * Toma las categorías maestras de los últimos productos vistos por el usuario
   * y sugiere otros productos visibles de esas categorías, excluyendo los ya
   * vistos. Sin historial suficiente, cae a los más vendidos de la semana.
   */
  async getRecomendados(usuarioId: string, limit = 12) {
    const baseWhere: Prisma.ProductoWhereInput = {
      visibleMarketplace: true,
      isActive: true,
      deletedAt: null,
      esInsumo: false,
      empresa: { isActive: true, deletedAt: null, visibleEnMarketplace: true },
    };

    // Últimos vistos del usuario + la categoría maestra de cada uno.
    const vistos = await this.prisma.productoVisto.findMany({
      where: { usuarioId },
      orderBy: { vistoEn: 'desc' },
      take: 30,
      select: {
        productoId: true,
        producto: {
          select: {
            empresaCategoria: { select: { categoriaMaestraId: true } },
          },
        },
      },
    });

    const vistosIds = new Set(vistos.map((v) => v.productoId));
    const categoriaIds = [
      ...new Set(
        vistos
          .map((v) => v.producto?.empresaCategoria?.categoriaMaestraId)
          .filter((id): id is string => !!id),
      ),
    ];

    // Sin señal de categorías → fallback a más vendidos.
    if (categoriaIds.length === 0) {
      const home = await this.getHome();
      return {
        recomendados: home.masVendidos.slice(0, limit),
        basadoEnHistorial: false,
      };
    }

    const rows = await this.prisma.producto.findMany({
      where: {
        ...baseWhere,
        id: { notIn: [...vistosIds] },
        empresaCategoria: { categoriaMaestraId: { in: categoriaIds } },
      },
      include: this._includeMarketplace,
      orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
      take: 36,
    });
    const recomendados = (await this._mapearProductos(rows)).slice(0, limit);

    // Completar con más vendidos no repetidos si la categoría no rindió suficiente.
    if (recomendados.length < limit) {
      const home = await this.getHome();
      const yaIncluidos = new Set(recomendados.map((r) => r.id));
      for (const mv of home.masVendidos) {
        if (recomendados.length >= limit) break;
        if (!yaIncluidos.has(mv.id) && !vistosIds.has(mv.id)) {
          recomendados.push(mv);
          yaIncluidos.add(mv.id);
        }
      }
    }

    return { recomendados, basadoEnHistorial: true };
  }

  /**
   * Home del marketplace por secciones (estilo MercadoLibre):
   * - ofertas: productos con oferta vigente.
   * - masVistos: top productos por cantidad de vistas (ProductoVisto, global).
   * - categorias: categorías maestras activas (cards).
   * "Vistos recientemente" es por-usuario → lo sirve marketplace-usuario.
   */
  async getHome() {
    const baseWhere: Prisma.ProductoWhereInput = {
      visibleMarketplace: true,
      isActive: true,
      deletedAt: null,
      esInsumo: false,
      empresa: { isActive: true, deletedAt: null, visibleEnMarketplace: true },
    };

    // ── Ofertas: al menos una sede en oferta con precio configurado. El mapeo
    //    valida la vigencia por fechas → nos quedamos con las realmente activas.
    const ofertasRaw = await this.prisma.producto.findMany({
      where: {
        ...baseWhere,
        stocksPorSede: { some: { enOferta: true, precioConfigurado: true } },
      },
      include: this._includeMarketplace,
      orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
      take: 24,
    });
    const ofertas = (await this._mapearProductos(ofertasRaw))
      .filter((p) => p.enOferta)
      .slice(0, 12);

    // ── Más vistos: agregamos ProductoVisto por producto (global). Pedimos de
    //    más porque algunos vistos pueden ya no estar visibles/activos.
    const masVistosAgg = await this.prisma.productoVisto.groupBy({
      by: ['productoId'],
      _count: { productoId: true },
      orderBy: { _count: { productoId: 'desc' } },
      take: 36,
    });
    let masVistos: any[] = [];
    const masVistosIds = masVistosAgg.map((v) => v.productoId);
    if (masVistosIds.length > 0) {
      const rows = await this.prisma.producto.findMany({
        where: { ...baseWhere, id: { in: masVistosIds } },
        include: this._includeMarketplace,
      });
      const byId = new Map(rows.map((p) => [p.id, p]));
      const ordenados = masVistosIds
        .map((id) => byId.get(id))
        .filter((p): p is (typeof rows)[number] => !!p)
        .slice(0, 12);
      masVistos = await this._mapearProductos(ordenados);
    }

    // ── Más vendidos de la semana: agregamos VentaDetalle de los últimos 7
    //    días (ventas no anuladas/borrador) por producto. Top 12 visibles.
    const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const vendidosAgg = await this.prisma.ventaDetalle.groupBy({
      by: ['productoId'],
      where: {
        productoId: { not: null },
        venta: {
          fechaVenta: { gte: hace7dias },
          estado: { notIn: ['BORRADOR', 'ANULADA'] },
        },
      },
      _sum: { cantidad: true },
      orderBy: { _sum: { cantidad: 'desc' } },
      take: 36,
    });
    let masVendidos: any[] = [];
    const vendidosIds = vendidosAgg
      .map((v) => v.productoId)
      .filter((id): id is string => !!id);
    if (vendidosIds.length > 0) {
      const rows = await this.prisma.producto.findMany({
        where: { ...baseWhere, id: { in: vendidosIds } },
        include: this._includeMarketplace,
      });
      const byId = new Map(rows.map((p) => [p.id, p]));
      const ordenados = vendidosIds
        .map((id) => byId.get(id))
        .filter((p): p is (typeof rows)[number] => !!p)
        .slice(0, 12);
      masVendidos = await this._mapearProductos(ordenados);
    }

    const categorias = await this.getCategorias();

    return { ofertas, masVendidos, masVistos, categorias, cortina: await this._getCortina() };
  }

  /**
   * Cortina del marketplace: cuando el super admin la activa (syncronize-admin
   * → Configuración del Sistema), el app tapa toda la sección de productos
   * con este mensaje. Se entrega junto al home para no sumar un request.
   */
  private async _getCortina() {
    try {
      const config = await this.prisma.configuracionSistema.findFirst({
        select: {
          marketplaceCortinaActiva: true,
          marketplaceCortinaTitulo: true,
          marketplaceCortinaMensaje: true,
        },
      });
      return {
        activa: config?.marketplaceCortinaActiva ?? false,
        titulo: config?.marketplaceCortinaTitulo ?? null,
        mensaje: config?.marketplaceCortinaMensaje ?? null,
      };
    } catch {
      // Si la migración aún no corrió (ventana deploy→migrate) el home no
      // debe caerse: cortina desactivada por defecto.
      return { activa: false, titulo: null, mensaje: null };
    }
  }

  /**
   * Detalle de un producto (búsqueda global por ID)
   */
  async getProductoDetalle(id: string) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, visibleMarketplace: true, isActive: true, deletedAt: null },
      include: {
        empresaCategoria: {
          include: { categoriaMaestra: { select: { id: true, nombre: true } } },
        },
        empresaMarca: {
          include: { marcaMaestra: { select: { id: true, nombre: true } } },
        },
        empresa: {
          select: {
            id: true, nombre: true, logo: true, subdominio: true, descripcion: true,
            rubro: true, departamento: true, provincia: true, distrito: true,
            telefono: true, email: true, web: true,
            configuracionDocumentos: { select: { nombreComercial: true } },
            sedes: {
              where: { isActive: true, deletedAt: null },
              orderBy: { esPrincipal: 'desc' as const },
              take: 1,
              select: { direccion: true, distrito: true, provincia: true, departamento: true },
            },
          },
        },
        stocksPorSede: {
          where: { precioConfigurado: true },
          // Todas las sedes con precio; _seleccionarStock elige la de mejor
          // precio efectivo (oferta-aware), igual que la lista → coinciden.
          orderBy: { precio: 'asc' },
          select: {
            precio: true, precioOferta: true, enOferta: true, stockActual: true,
            fechaInicioOferta: true, fechaFinOferta: true,
            sede: { select: { nombre: true, coordenadas: true, direccion: true, distrito: true, provincia: true } },
          },
        },
        atributosValores: {
          include: {
            atributo: { select: { nombre: true, mostrarEnMarketplace: true } },
          },
        },
        // Precios por nivel/volumen (por mayor) del producto base.
        preciosNivel: {
          where: { isActive: true },
          orderBy: { cantidadMinima: 'asc' },
          select: {
            nombre: true, cantidadMinima: true, cantidadMaxima: true,
            tipoPrecio: true, precio: true, porcentajeDesc: true, descripcion: true,
          },
        },
        // Variantes activas con sus atributos (para el selector) y su stock/
        // precio/oferta por sede (cada variante tiene su propio precio y stock).
        variantes: {
          where: { isActive: true, deletedAt: null },
          orderBy: { orden: 'asc' },
          select: {
            id: true, nombre: true, sku: true,
            atributosValores: {
              select: { valor: true, atributo: { select: { nombre: true } } },
            },
            stocksPorSede: {
              where: { precioConfigurado: true },
              orderBy: { precio: 'asc' },
              select: {
                precio: true, precioOferta: true, enOferta: true, stockActual: true,
                fechaInicioOferta: true, fechaFinOferta: true,
                sede: { select: { nombre: true, coordenadas: true, direccion: true, distrito: true, provincia: true } },
              },
            },
            preciosNivel: {
              where: { isActive: true },
              orderBy: { cantidadMinima: 'asc' },
              select: {
                nombre: true, cantidadMinima: true, cantidadMaxima: true,
                tipoPrecio: true, precio: true, porcentajeDesc: true, descripcion: true,
              },
            },
          },
        },
      },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    // Obtener imágenes
    const imagenes = await this.prisma.archivo.findMany({
      where: {
        entidadTipo: 'PRODUCTO',
        entidadId: producto.id,
        tipoArchivo: 'IMAGEN',
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, url: true, urlThumbnail: true },
      orderBy: { orden: 'asc' },
    });

    // Imágenes por variante (los productos con variantes suelen tener las
    // imágenes en las variantes, no en el producto base).
    const variantIds = (producto.variantes ?? []).map((v: any) => v.id);
    const varImgs = variantIds.length
      ? await this.prisma.archivo.findMany({
          where: {
            entidadTipo: 'PRODUCTO_VARIANTE',
            entidadId: { in: variantIds },
            tipoArchivo: 'IMAGEN',
            isActive: true,
            deletedAt: null,
          },
          select: { entidadId: true, url: true, urlThumbnail: true },
          orderBy: { orden: 'asc' },
        })
      : [];
    const varImgMap = new Map<string, { url: string; thumbnail: string | null }[]>();
    for (const im of varImgs) {
      if (!im.entidadId) continue;
      const arr = varImgMap.get(im.entidadId) ?? [];
      arr.push({ url: im.url, thumbnail: im.urlThumbnail });
      varImgMap.set(im.entidadId, arr);
    }

    // Poster del video: el thumbnail (webp) generado al subir, para mostrarlo
    // al instante mientras el video bufferea (mejora la percepción de carga).
    let videoThumbnailUrl: string | null = null;
    if (producto.videoUrl) {
      const videoArchivo = await this.prisma.archivo.findFirst({
        where: {
          entidadTipo: 'PRODUCTO',
          entidadId: producto.id,
          tipoArchivo: 'VIDEO',
          isActive: true,
          deletedAt: null,
        },
        select: { urlThumbnail: true },
        orderBy: { creadoEn: 'desc' },
      });
      videoThumbnailUrl = videoArchivo?.urlThumbnail ?? null;
    }

    // Prueba social honesta (datos reales): promedio de opiniones + total vendido
    // (ventas no anuladas/borrador). Alimenta las estrellas y el "X vendidos" del
    // detalle, al estilo Temu pero sin inventar números.
    const [opinionAgg, vendidosAgg] = await Promise.all([
      this.prisma.opinionProducto.aggregate({
        where: { productoId: producto.id },
        _avg: { calificacion: true },
        _count: true,
      }),
      this.prisma.ventaDetalle.aggregate({
        where: {
          productoId: producto.id,
          venta: { estado: { notIn: ['BORRADOR', 'ANULADA'] } },
        },
        _sum: { cantidad: true },
      }),
    ]);
    const totalOpiniones = opinionAgg._count;
    const calificacion = totalOpiniones > 0
      ? Math.round((opinionAgg._avg.calificacion ?? 0) * 10) / 10
      : null;
    const vendidos = Number(vendidosAgg._sum.cantidad ?? 0);

    // Variantes: cada una con su atributos (para el selector) + su precio/
    // stock/oferta por sede (elegido oferta-aware, igual que el producto base).
    const variantes = (producto.variantes ?? []).map((v: any) => {
      const s = this._seleccionarStock(v.stocksPorSede);
      const ofertaV = this._ofertaVigente(s);
      return {
        id: v.id,
        nombre: v.nombre,
        // Se incluyen TODOS los atributos de la variante (definen la combinación
        // Color/Tamaño/…); no se filtran por mostrarEnMarketplace porque son los
        // que el comprador necesita para elegir.
        atributos: (v.atributosValores ?? []).map((a: any) => ({
          nombre: a.atributo?.nombre ?? '',
          valor: a.valor,
        })),
        imagenes: varImgMap.get(v.id) ?? [],
        niveles: this._mapNiveles(v.preciosNivel),
        sede: s?.sede?.nombre ?? null,
        sedeDireccion: s?.sede
          ? [s.sede.direccion, s.sede.distrito, s.sede.provincia].filter(Boolean).join(', ') || null
          : null,
        precio: s?.precio ? Number(s.precio) : null,
        precioOferta: ofertaV && s?.precioOferta ? Number(s.precioOferta) : null,
        enOferta: ofertaV,
        hayStock: s?.stockActual ? s.stockActual > 0 : false,
        stockActual: s?.stockActual ?? 0,
        ofertaSede: ofertaV ? (s?.sede?.nombre ?? null) : null,
        ofertaFin: ofertaV ? (s?.fechaFinOferta ?? null) : null,
      };
    });

    // Stock a mostrar en el header: menor precio efectivo entre el base y TODAS
    // las variantes (el "desde"). Coincide con el criterio de la lista.
    const variantStocks = (producto.variantes ?? []).flatMap((v: any) => v.stocksPorSede ?? []);
    const stock = this._seleccionarStock([...(producto.stocksPorSede ?? []), ...variantStocks]);
    const ofertaActiva = this._ofertaVigente(stock);

    // Productos relacionados: misma categoría maestra, otras tiendas/productos.
    const categoriaMaestraId =
      producto.empresaCategoria?.categoriaMaestra?.id ?? null;
    let relacionados: any[] = [];
    if (categoriaMaestraId) {
      const relRaw = await this.prisma.producto.findMany({
        where: {
          id: { not: producto.id },
          visibleMarketplace: true,
          isActive: true,
          deletedAt: null,
          esInsumo: false,
          empresa: {
            isActive: true,
            deletedAt: null,
            visibleEnMarketplace: true,
          },
          empresaCategoria: { categoriaMaestraId },
        },
        include: this._includeMarketplace,
        orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
        take: 10,
      });
      relacionados = await this._mapearProductos(relRaw);
    }

    return {
      id: producto.id,
      nombre: producto.nombre,
      descripcion: producto.descripcion,
      categoria: producto.empresaCategoria?.nombrePersonalizado
        || producto.empresaCategoria?.categoriaMaestra?.nombre || null,
      marca: producto.empresaMarca?.nombrePersonalizado
        || producto.empresaMarca?.marcaMaestra?.nombre || null,
      precio: stock?.precio ? Number(stock.precio) : null,
      precioOferta: ofertaActiva && stock?.precioOferta ? Number(stock.precioOferta) : null,
      enOferta: ofertaActiva,
      ofertaSede: ofertaActiva ? (stock?.sede?.nombre ?? null) : null,
      ofertaInicio: ofertaActiva ? stock?.fechaInicioOferta ?? null : null,
      ofertaFin: ofertaActiva ? stock?.fechaFinOferta ?? null : null,
      hayStock: [...(producto.stocksPorSede ?? []), ...variantStocks]
        .some((s: any) => (s.stockActual ?? 0) > 0),
      stockActual: stock?.stockActual ?? 0,
      tieneVariantes: variantes.length > 0,
      variantes,
      niveles: this._mapNiveles(producto.preciosNivel),
      calificacion,
      totalOpiniones,
      vendidos,
      videoUrl: producto.videoUrl || null,
      videoThumbnailUrl,
      imagenes: imagenes.map((i) => ({ id: i.id, url: i.url, thumbnail: i.urlThumbnail })),
      atributos: producto.atributosValores
        .filter((a) => a.atributo.mostrarEnMarketplace)
        .map((a) => ({ nombre: a.atributo.nombre, valor: a.valor })),
      // Los mismos atributos, agrupados en las secciones con las que se
      // cargaron. Se arman ACÁ y no en el navegador: el marketplace es público
      // y no puede andar pidiendo plantillas y cruzándolas del lado del
      // cliente. `atributos` se mantiene por compatibilidad y como respaldo.
      seccionesAtributos: await this._seccionesDeAtributos(producto),
      empresa: {
        id: producto.empresa.id,
        nombre: producto.empresa.configuracionDocumentos?.nombreComercial || producto.empresa.nombre,
        logo: producto.empresa.logo,
        subdominio: producto.empresa.subdominio,
        descripcion: producto.empresa.descripcion,
        rubro: producto.empresa.rubro,
        telefono: producto.empresa.telefono,
        email: producto.empresa.email,
        web: producto.empresa.web,
        direccion: producto.empresa.sedes?.[0]?.direccion ?? null,
        ubicacion: this._ubicacionSedePrincipal(producto.empresa),
      },
      sede: stock?.sede ? {
        nombre: stock.sede.nombre,
        direccion: stock.sede.direccion,
        distrito: stock.sede.distrito,
        provincia: stock.sede.provincia,
        coordenadas: (stock.sede.coordenadas as any) ?? null,
      } : null,
      relacionados,
    };
  }

  /**
   * Categorías disponibles en el marketplace
   */
  /**
   * Atributos que el marketplace puede ofrecer como filtro.
   *
   * 🔑 Acá es CROSS-EMPRESA, y ahí está la diferencia con el catálogo interno:
   * `clave` es única por empresa, así que veinte empresas pueden tener su
   * propio "color". Se unen por clave y se hace la unión de sus valores; si no,
   * el comprador vería veinte filtros "Color" idénticos.
   *
   * Solo entran los marcados `usarParaFiltros` **y** `mostrarEnMarketplace`, y
   * de empresas visibles: un atributo interno no tiene por qué asomar al
   * público.
   */
  /**
   * Los atributos del producto repartidos en las secciones con las que se
   * cargaron: PROCESADOR, MEMORIA, PANTALLA, DISEÑO.
   *
   * Devuelve `[]` si el producto no tiene secciones guardadas —los de antes de
   * que existieran— y ahí el cliente cae a la lista plana de `atributos`.
   *
   * 🔑 Los SUELTOS van igual, bajo "Otras": un atributo cargado a mano, o de
   * una plantilla que después se quitó, sigue siendo un dato del producto.
   * Esconderlo sería peor que no agruparlo.
   */
  private async _seccionesDeAtributos(producto: any) {
    const ids: string[] = producto.plantillasAtributosIds ?? [];
    const visibles = (producto.atributosValores ?? []).filter(
      (a: any) => a.atributo.mostrarEnMarketplace,
    );
    if (visibles.length === 0) return [];

    const plantillas = ids.length
      ? await this.prisma.productoAtributoPlantilla.findMany({
          where: { id: { in: ids }, isActive: true },
          select: {
            id: true,
            nombre: true,
            atributos: {
              select: { atributoId: true, orden: true },
              orderBy: { orden: 'asc' },
            },
          },
        })
      : [];

    // Respetar el orden en que el producto las guardó.
    plantillas.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    const usados = new Set<string>();
    const secciones: { nombre: string; atributos: any[] }[] = [];

    for (const pl of plantillas) {
      const propios: any[] = [];
      for (const pa of pl.atributos) {
        const av = visibles.find((v: any) => v.atributoId === pa.atributoId);
        // `usados` evita repetir un atributo que está en dos plantillas.
        if (av && !usados.has(pa.atributoId)) {
          usados.add(pa.atributoId);
          propios.push({ nombre: av.atributo.nombre, valor: av.valor });
        }
      }
      if (propios.length > 0) {
        secciones.push({ nombre: pl.nombre, atributos: propios });
      }
    }

    const sueltos = visibles
      .filter((a: any) => !usados.has(a.atributoId))
      .map((a: any) => ({ nombre: a.atributo.nombre, valor: a.valor }));
    if (sueltos.length > 0) {
      secciones.push({ nombre: 'Otras', atributos: sueltos });
    }

    // Una sola sección "Otras" no es agrupar nada: que el cliente muestre la
    // lista plana de siempre.
    if (secciones.length === 1 && secciones[0].nombre === 'Otras') return [];

    return secciones;
  }

  async getFiltrosAtributos(categoriaId?: string) {
    const atributos = await this.prisma.productoAtributo.findMany({
      where: {
        isActive: true,
        usarParaFiltros: true,
        mostrarEnMarketplace: true,
        tipo: { in: ['SELECT', 'MULTI_SELECT', 'SELECT_DEPENDIENTE'] },
        empresa: { isActive: true, deletedAt: null, visibleEnMarketplace: true },
      },
      select: { nombre: true, clave: true, valores: true, orden: true },
      orderBy: { orden: 'asc' },
      take: 300,
    });

    const porClave = new Map<
      string,
      { nombre: string; clave: string; valores: Set<string>; orden: number }
    >();

    for (const a of atributos) {
      const actual = porClave.get(a.clave);
      if (actual) {
        for (const v of a.valores) actual.valores.add(v);
      } else {
        porClave.set(a.clave, {
          // Gana el nombre del primero, que por el orderBy es el de menor
          // `orden`. Dos empresas pueden escribirlo distinto ("Color" vs
          // "COLOR") y hay que elegir uno.
          nombre: a.nombre,
          clave: a.clave,
          valores: new Set(a.valores),
          orden: a.orden,
        });
      }
    }

    // `categoriaId` no filtra todavía: las categorías del marketplace son
    // MAESTRAS y los atributos se asocian a las categorías de cada empresa, así
    // que el cruce no es directo. Se recibe para no cambiar la firma después.
    void categoriaId;

    return Array.from(porClave.values())
      .filter((a) => a.valores.size > 0)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
      .map((a) => ({
        nombre: a.nombre,
        clave: a.clave,
        valores: Array.from(a.valores).sort((x, y) => x.localeCompare(y)),
      }));
  }

  async getCategorias() {
    return this.prisma.categoriaMaestra.findMany({
      where: { isActive: true },
      select: {
        id: true,
        nombre: true,
        slug: true,
        icono: true,
        padreId: true,
      },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Autocomplete del buscador del marketplace. Devuelve categorías maestras y
   * productos visibles cuyo nombre matchea el término (prefijo/substring). Es
   * liviano: sólo id/nombre + thumbnail del producto para un dropdown rápido.
   */
  async getSugerencias(q: string, limit = 8) {
    const term = (q ?? '').trim();
    if (term.length < 2) return { categorias: [], productos: [] };

    const baseWhere: Prisma.ProductoWhereInput = {
      visibleMarketplace: true,
      isActive: true,
      deletedAt: null,
      esInsumo: false,
      nombre: { contains: term, mode: 'insensitive' },
      empresa: { isActive: true, deletedAt: null, visibleEnMarketplace: true },
    };

    const [categorias, productos] = await Promise.all([
      this.prisma.categoriaMaestra.findMany({
        where: { isActive: true, nombre: { contains: term, mode: 'insensitive' } },
        select: { id: true, nombre: true, icono: true },
        orderBy: [{ esPopular: 'desc' }, { nombre: 'asc' }],
        take: 5,
      }),
      this.prisma.producto.findMany({
        where: baseWhere,
        select: { id: true, nombre: true },
        orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
        take: limit,
      }),
    ]);

    // Thumbnail por producto sugerido (una sola consulta batched).
    const productoIds = productos.map((p) => p.id);
    const imagenes = productoIds.length > 0
      ? await this.prisma.archivo.findMany({
          where: {
            entidadTipo: 'PRODUCTO',
            entidadId: { in: productoIds },
            tipoArchivo: 'IMAGEN',
            isActive: true,
            deletedAt: null,
          },
          select: { entidadId: true, url: true, urlThumbnail: true },
          orderBy: { orden: 'asc' },
        })
      : [];
    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    return {
      categorias,
      productos: productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        imagen: imagenMap.get(p.id) ?? null,
      })),
    };
  }

  /**
   * Obtener todas las empresas activas para el marketplace público
   */
  async getAllEmpresas(page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where = {
      isActive: true,
      deletedAt: null,
      visibleEnMarketplace: true, // Solo empresas visibles en marketplace
      // Solo empresas con subdominio configurado (empresas públicas)
      subdominio: {
        not: null,
      },
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' as const } },
          { descripcion: { contains: search, mode: 'insensitive' as const } },
          { ruc: { contains: search, mode: 'insensitive' as const } },
          { keywords: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [empresas, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          subdominio: true,
          logo: true,
          descripcion: true,
          email: true,
          telefono: true,
          web: true,
          destacadoMarketplace: true,
          vistasMarketplace: true,
          // Redes sociales
          facebook: true,
          instagram: true,
          twitter: true,
          linkedin: true,
          // SEO
          metaTitle: true,
          metaDescription: true,
          configuracionDocumentos: { select: { nombreComercial: true } },
          planSuscripcion: {
            select: {
              nombre: true,
            },
          },
          creadoEn: true,
        },
        orderBy: [
          { destacadoMarketplace: 'desc' }, // Destacados primero
          { ordenMarketplace: 'asc' }, // Luego por orden personalizado
          { creadoEn: 'desc' }, // Finalmente por fecha de creación
        ],
      }),
      this.prisma.empresa.count({ where }),
    ]);

    // Reputación (★ promedio · N opiniones) por empresa para la card.
    const reputacionMap = await this._reputacionPorEmpresa(empresas.map((e) => e.id));
    const data = empresas.map(({ configuracionDocumentos, ...e }) => ({
      ...e,
      nombre: configuracionDocumentos?.nombreComercial || e.nombre,
      reputacion: reputacionMap.get(e.id) ?? { promedio: 0, totalOpiniones: 0 },
    }));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtener detalles de una empresa por subdominio
   */
  async getEmpresaBySubdominio(subdominio: string) {
    // Incrementar contador de vistas
    await this.prisma.empresa.updateMany({
      where: {
        subdominio,
        isActive: true,
        deletedAt: null,
        visibleEnMarketplace: true,
      },
      data: {
        vistasMarketplace: {
          increment: 1,
        },
      },
    });

    const empresa = await this.prisma.empresa.findFirst({
      where: {
        subdominio,
        isActive: true,
        deletedAt: null,
        visibleEnMarketplace: true,
      },
      select: {
        id: true,
        nombre: true,
        ruc: true,
        subdominio: true,
        logo: true,
        descripcion: true,
        email: true,
        telefono: true,
        web: true,
        destacadoMarketplace: true,
        vistasMarketplace: true,
        // Redes sociales
        facebook: true,
        instagram: true,
        twitter: true,
        linkedin: true,
        // SEO
        metaTitle: true,
        metaDescription: true,
        keywords: true,
        configuracionDocumentos: { select: { nombreComercial: true } },
        fechaFinWebGratuita: true,
        planSuscripcion: {
          select: {
            id: true,
            nombre: true,
            descripcion: true,
            tieneWebPermanente: true,
          },
        },
        creadoEn: true,
        // Personalización (banner, colores)
        personalizaciones: {
          select: {
            bannerPrincipalUrl: true,
            bannerPrincipalTexto: true,
            banners: true,
            colorPrimario: true,
            colorSecundario: true,
            colorAcento: true,
            bannerColor: true,
            webConfig: true,
          },
          take: 1,
        },
        // Sedes activas con información de ubicación
        sedes: {
          where: { isActive: true, deletedAt: null },
          select: {
            id: true,
            nombre: true,
            telefono: true,
            email: true,
            direccion: true,
            referencia: true,
            stand: true,
            distrito: true,
            provincia: true,
            departamento: true,
            coordenadas: true,
            imagenes: true,
            horarioAtencion: true,
            esPrincipal: true,
          },
          orderBy: { esPrincipal: 'desc' },
        },
        // Contar productos y servicios activos
        _count: {
          select: {
            productos: {
              where: {
                isActive: true,
                deletedAt: null,
              },
            },
            servicios: {
              where: {
                isActive: true,
                deletedAt: null,
              },
            },
          },
        },
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada o no disponible en el marketplace');
    }

    // Reputación agregada del vendedor (promedio de todas las opiniones de sus productos).
    const reputacionMap = await this._reputacionPorEmpresa([empresa.id]);
    const reputacion = reputacionMap.get(empresa.id) ?? { promedio: 0, totalOpiniones: 0 };

    // Verificar disponibilidad de la página web
    const tieneWebPermanente = empresa.planSuscripcion?.tieneWebPermanente ?? false;
    if (!tieneWebPermanente) {
      const fechaFin = empresa.fechaFinWebGratuita;
      if (!fechaFin || new Date() > new Date(fechaFin)) {
        throw new ForbiddenException(
          'La página web de esta empresa no está disponible. El periodo de prueba ha finalizado.',
        );
      }
    }

    const { configuracionDocumentos, ...empresaData } = empresa;
    return {
      ...empresaData,
      nombre: configuracionDocumentos?.nombreComercial || empresa.nombre,
      reputacion,
    };
  }

  /**
   * Obtener productos de una empresa por subdominio
   */
  async getProductosByEmpresa(
    subdominio: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    const empresa = await this.prisma.empresa.findFirst({
      where: { subdominio, isActive: true, deletedAt: null, visibleEnMarketplace: true },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const skip = (page - 1) * limit;

    const where: any = {
      empresaId: empresa.id,
      visibleMarketplace: true,
      isActive: true,
      deletedAt: null,
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' as const } },
          { descripcion: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    // Mismo include + hidratación que el feed principal: así los productos
    // con VARIANTES muestran precio "desde"/stock/imagen desde sus variantes
    // (antes este endpoint solo leía el stock del producto base → los
    // productos con variantes salían sin precio, sin imagen y "sin stock").
    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        include: this._includeMarketplace,
        orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.producto.count({ where }),
    ]);

    const data = await this._mapearProductos(productos);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Obtener servicios de una empresa por subdominio
   */
  async getServiciosByEmpresa(
    subdominio: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    // Primero verificar que la empresa existe
    const empresa = await this.prisma.empresa.findFirst({
      where: {
        subdominio,
        isActive: true,
        deletedAt: null,
        visibleEnMarketplace: true,
      },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const skip = (page - 1) * limit;

    const where = {
      empresaId: empresa.id,
      isActive: true,
      deletedAt: null,
      visibleMarketplace: true, // Solo servicios visibles en marketplace
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' as const } },
          { descripcion: { contains: search, mode: 'insensitive' as const } },
          { codigoEmpresa: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [servicios, total] = await Promise.all([
      this.prisma.servicio.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          codigoEmpresa: true,
          descripcion: true,
          precio: true,
          precioPorHora: true,
          duracionMinutos: true,
          duracionHoras: true,
          requiereReserva: true,
          destacado: true,
          // Campos de ofertas
          enOferta: true,
          precioOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          empresaCategoria: {
            select: {
              id: true,
              nombreLocal: true,
              categoriaMaestra: {
                select: {
                  nombre: true,
                  slug: true,
                },
              },
              nombrePersonalizado: true,
            },
          },
          creadoEn: true,
        },
        orderBy: [
          { destacado: 'desc' }, // Destacados primero
          { ordenMarketplace: 'asc' }, // Orden personalizado
          // ❌ { enOferta: 'desc' } - DEPRECATED: enOferta ahora en ProductoStock
          { creadoEn: 'desc' }, // Más recientes al final
        ],
      }),
      this.prisma.servicio.count({ where }),
    ]);

    return {
      data: servicios,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtener detalles de un producto específico
   */
  async getProductoById(subdominio: string, productoId: string) {
    const producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        isActive: true,
        deletedAt: null,
        empresa: {
          subdominio,
          isActive: true,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        codigoSistema: true,
        sku: true,
        codigoBarras: true,
        descripcion: true,
        // ❌ precio/precioCosto - DEPRECATED: Ahora en ProductoStock
        peso: true,
        dimensiones: true,
        // Stock por sede (ahora incluye precios)
        stocksPorSede: {
          select: {
            stockActual: true,
            stockMinimo: true,
            stockMaximo: true,
            ubicacion: true,
            // ✅ Precios ahora vienen de ProductoStock
            precio: true,
            precioCosto: true,
            precioOferta: true,
            enOferta: true,
            precioConfigurado: true,
            sede: {
              select: {
                id: true,
                nombre: true,
                codigo: true,
              },
            },
          },
        },
        empresaCategoria: {
          select: {
            id: true,
            nombreLocal: true,
            categoriaMaestra: {
              select: {
                nombre: true,
                slug: true,
              },
            },
            nombrePersonalizado: true,
          },
        },
        empresaMarca: {
          select: {
            id: true,
            nombreLocal: true,
            marcaMaestra: {
              select: {
                nombre: true,
                slug: true,
                logo: true,
              },
            },
            nombrePersonalizado: true,
          },
        },
        empresa: {
          select: {
            id: true,
            nombre: true,
            subdominio: true,
            logo: true,
          },
        },
        creadoEn: true,
        actualizadoEn: true,
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return producto;
  }

  /**
   * Obtener detalles de un servicio específico
   */
  async getServicioById(subdominio: string, servicioId: string) {
    const servicio = await this.prisma.servicio.findFirst({
      where: {
        id: servicioId,
        isActive: true,
        deletedAt: null,
        empresa: {
          subdominio,
          isActive: true,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        codigoSistema: true,
        descripcion: true,
        precio: true,
        precioPorHora: true,
        duracionMinutos: true,
        duracionHoras: true,
        requiereReserva: true,
        requiereDeposito: true,
        depositoPorcentaje: true,
        videoUrl: true,
        empresaCategoria: {
          select: {
            id: true,
            nombreLocal: true,
            categoriaMaestra: {
              select: {
                nombre: true,
                slug: true,
              },
            },
            nombrePersonalizado: true,
          },
        },
        empresa: {
          select: {
            id: true,
            nombre: true,
            subdominio: true,
            logo: true,
          },
        },
        creadoEn: true,
        actualizadoEn: true,
      },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return servicio;
  }
}
