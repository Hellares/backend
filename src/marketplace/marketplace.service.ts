import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
        },
      },
      stocksPorSede: {
        where: { precioConfigurado: true },
        select: {
          precio: true, precioOferta: true, enOferta: true, stockActual: true,
          fechaInicioOferta: true, fechaFinOferta: true,
          sede: { select: { coordenadas: true } },
        },
        take: 1,
        orderBy: { precio: 'asc' },
      },
    };
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
      select: { entidadId: true, url: true, urlThumbnail: true, orden: true },
      orderBy: { orden: 'asc' },
    });
    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
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

    return productos.map((p: any) => {
      const stock = p.stocksPorSede[0];
      const coordenadas = stock?.sede?.coordenadas as any;
      let distancia: number | null = null;

      const coordLng = coordenadas?.lng ?? coordenadas?.lon;
      if (userLat && userLng && coordenadas?.lat && coordLng) {
        distancia = Math.round(
          this.calcularDistancia(userLat, userLng, coordenadas.lat, coordLng) * 10,
        ) / 10;
      }

      let ofertaActiva = false;
      if (stock?.enOferta && stock?.precioOferta) {
        const ahora = new Date();
        const inicio = stock.fechaInicioOferta ? new Date(stock.fechaInicioOferta) : null;
        const fin = stock.fechaFinOferta ? new Date(stock.fechaFinOferta) : null;
        if (inicio && fin) ofertaActiva = ahora >= inicio && ahora <= fin;
        else if (inicio) ofertaActiva = ahora >= inicio;
        else if (fin) ofertaActiva = ahora <= fin;
        else ofertaActiva = true;
      }

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
        hayStock: stock?.stockActual ? stock.stockActual > 0 : false,
        imagen: imagenMap.get(p.id) ?? null,
        calificacion: opinionMap.get(p.id)?.promedio ?? null,
        totalOpiniones: opinionMap.get(p.id)?.total ?? 0,
        distancia,
        coordenadas: coordenadas
          ? { lat: coordenadas.lat, lng: coordenadas.lng ?? coordenadas.lon }
          : null,
        destacado: p.destacado,
        creadoEn: p.creadoEn,
        empresa: {
          id: p.empresa.id,
          nombre: p.empresa.nombre,
          logo: p.empresa.logo,
          subdominio: p.empresa.subdominio,
          telefono: p.empresa.telefono,
          ubicacion: [p.empresa.distrito, p.empresa.provincia, p.empresa.departamento]
            .filter(Boolean).join(', '),
        },
      };
    });
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

    return { ofertas, masVendidos, masVistos, categorias };
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
          },
        },
        stocksPorSede: {
          where: { precioConfigurado: true },
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

    const stock = producto.stocksPorSede[0];

    // Validar oferta vigente
    let ofertaActiva = false;
    if (stock?.enOferta && stock?.precioOferta) {
      const ahora = new Date();
      const inicio = stock.fechaInicioOferta ? new Date(stock.fechaInicioOferta) : null;
      const fin = stock.fechaFinOferta ? new Date(stock.fechaFinOferta) : null;
      if (inicio && fin) ofertaActiva = ahora >= inicio && ahora <= fin;
      else if (inicio) ofertaActiva = ahora >= inicio;
      else if (fin) ofertaActiva = ahora <= fin;
      else ofertaActiva = true;
    }

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
      hayStock: stock?.stockActual ? stock.stockActual > 0 : false,
      stockActual: stock?.stockActual ?? 0,
      videoUrl: producto.videoUrl || null,
      imagenes: imagenes.map((i) => ({ id: i.id, url: i.url, thumbnail: i.urlThumbnail })),
      atributos: producto.atributosValores
        .filter((a) => a.atributo.mostrarEnMarketplace)
        .map((a) => ({ nombre: a.atributo.nombre, valor: a.valor })),
      empresa: {
        id: producto.empresa.id,
        nombre: producto.empresa.nombre,
        logo: producto.empresa.logo,
        subdominio: producto.empresa.subdominio,
        descripcion: producto.empresa.descripcion,
        rubro: producto.empresa.rubro,
        telefono: producto.empresa.telefono,
        email: producto.empresa.email,
        web: producto.empresa.web,
        ubicacion: [producto.empresa.distrito, producto.empresa.provincia, producto.empresa.departamento]
          .filter(Boolean).join(', '),
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

    return {
      data: empresas,
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

    return empresa;
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

    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        include: {
          empresaCategoria: {
            include: { categoriaMaestra: { select: { id: true, nombre: true } } },
          },
          empresaMarca: {
            include: { marcaMaestra: { select: { id: true, nombre: true } } },
          },
          empresa: {
            select: {
              id: true, nombre: true, logo: true, subdominio: true,
              departamento: true, provincia: true, distrito: true, telefono: true,
            },
          },
          stocksPorSede: {
            where: { precioConfigurado: true },
            select: { precio: true, precioOferta: true, enOferta: true, stockActual: true },
            take: 1,
            orderBy: { precio: 'asc' as const },
          },
        },
        orderBy: [{ destacado: 'desc' }, { creadoEn: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Obtener imágenes
    const productoIds = productos.map((p) => p.id);
    const imagenes = productoIds.length > 0
      ? await this.prisma.archivo.findMany({
          where: { entidadTipo: 'PRODUCTO', entidadId: { in: productoIds }, tipoArchivo: 'IMAGEN', isActive: true, deletedAt: null },
          select: { entidadId: true, url: true, urlThumbnail: true, orden: true },
          orderBy: { orden: 'asc' },
        })
      : [];

    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    // Opiniones
    const opinionesEmp = productoIds.length > 0
      ? await this.prisma.opinionProducto.groupBy({
          by: ['productoId'],
          where: { productoId: { in: productoIds } },
          _avg: { calificacion: true },
          _count: true,
        })
      : [];

    const opinionMapEmp = new Map<string, { promedio: number; total: number }>();
    for (const o of opinionesEmp) {
      opinionMapEmp.set(o.productoId, {
        promedio: Math.round((o._avg.calificacion ?? 0) * 10) / 10,
        total: o._count,
      });
    }

    const data = productos.map((p) => {
      const stock = p.stocksPorSede[0];
      return {
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcion?.substring(0, 120) || null,
        categoria: p.empresaCategoria?.nombrePersonalizado
          || p.empresaCategoria?.categoriaMaestra?.nombre || null,
        marca: p.empresaMarca?.nombrePersonalizado
          || p.empresaMarca?.marcaMaestra?.nombre || null,
        precio: stock?.precio ? Number(stock.precio) : null,
        precioOferta: stock?.enOferta && stock?.precioOferta ? Number(stock.precioOferta) : null,
        enOferta: stock?.enOferta ?? false,
        hayStock: stock?.stockActual ? stock.stockActual > 0 : false,
        imagen: imagenMap.get(p.id) ?? null,
        calificacion: opinionMapEmp.get(p.id)?.promedio ?? null,
        totalOpiniones: opinionMapEmp.get(p.id)?.total ?? 0,
        destacado: p.destacado,
        creadoEn: p.creadoEn,
        empresa: {
          id: p.empresa.id,
          nombre: p.empresa.nombre,
          logo: p.empresa.logo,
          subdominio: p.empresa.subdominio,
          telefono: p.empresa.telefono,
          ubicacion: [p.empresa.distrito, p.empresa.provincia, p.empresa.departamento]
            .filter(Boolean).join(', '),
        },
      };
    });

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
