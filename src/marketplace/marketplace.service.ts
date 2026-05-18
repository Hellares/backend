import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

    let orderBy: any = [{ destacado: 'desc' }, { creadoEn: 'desc' }];
    if (query.orden === 'recientes') orderBy = { creadoEn: 'desc' };

    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        include: {
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
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Obtener imágenes de productos en una sola query (evita N+1)
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
          select: { entidadId: true, url: true, urlThumbnail: true, orden: true },
          orderBy: { orden: 'asc' },
        })
      : [];

    // Mapa: primera imagen por producto
    const imagenMap = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenMap.has(img.entidadId)) {
        imagenMap.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    // Opiniones: promedio y total por producto
    const opiniones = productoIds.length > 0
      ? await this.prisma.opinionProducto.groupBy({
          by: ['productoId'],
          where: { productoId: { in: productoIds } },
          _avg: { calificacion: true },
          _count: true,
        })
      : [];

    const opinionMap = new Map<string, { promedio: number; total: number }>();
    for (const o of opiniones) {
      opinionMap.set(o.productoId, {
        promedio: Math.round((o._avg.calificacion ?? 0) * 10) / 10,
        total: o._count,
      });
    }

    const userLat = query.lat;
    const userLng = query.lng;

    let data = productos.map((p: any) => {
      const stock = p.stocksPorSede[0];
      const coordenadas = stock?.sede?.coordenadas as any;
      let distancia: number | null = null;

      const coordLng = coordenadas?.lng ?? coordenadas?.lon;
      if (userLat && userLng && coordenadas?.lat && coordLng) {
        distancia = Math.round(
          this.calcularDistancia(userLat, userLng, coordenadas.lat, coordLng) * 10
        ) / 10;
      }

      // Validar si la oferta está vigente
      let ofertaActiva = false;
      if (stock?.enOferta && stock?.precioOferta) {
        const ahora = new Date();
        const inicio = stock.fechaInicioOferta ? new Date(stock.fechaInicioOferta) : null;
        const fin = stock.fechaFinOferta ? new Date(stock.fechaFinOferta) : null;

        if (inicio && fin) {
          ofertaActiva = ahora >= inicio && ahora <= fin;
        } else if (inicio) {
          ofertaActiva = ahora >= inicio;
        } else if (fin) {
          ofertaActiva = ahora <= fin;
        } else {
          ofertaActiva = true; // Sin fechas = siempre activa
        }
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
        coordenadas: coordenadas ? { lat: coordenadas.lat, lng: coordenadas.lng ?? coordenadas.lon } : null,
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

    // Si el usuario tiene ubicación, priorizar productos cercanos (20 km)
    if (userLat && userLng) {
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
