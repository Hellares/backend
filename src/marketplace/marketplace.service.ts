import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

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
        planSuscripcion: {
          select: {
            id: true,
            nombre: true,
            descripcion: true,
          },
        },
        creadoEn: true,
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
      visibleMarketplace: true, // Solo productos visibles en marketplace
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' as const } },
          { descripcion: { contains: search, mode: 'insensitive' as const } },
          { codigoEmpresa: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          codigoEmpresa: true,
          descripcion: true,
          precio: true,
          precioCosto: true,
          stock: true,
          imagenes: true,
          destacado: true,
          // Campos de ofertas
          enOferta: true,
          precioOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          categoria: {
            select: {
              id: true,
              nombre: true,
            },
          },
          marca: {
            select: {
              id: true,
              nombre: true,
            },
          },
          creadoEn: true,
        },
        orderBy: [
          { destacado: 'desc' }, // Destacados primero
          { ordenMarketplace: 'asc' }, // Orden personalizado
          { enOferta: 'desc' }, // Ofertas después
          { creadoEn: 'desc' }, // Más recientes al final
        ],
      }),
      this.prisma.producto.count({ where }),
    ]);

    return {
      data: productos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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
          imagenes: true,
          destacado: true,
          // Campos de ofertas
          enOferta: true,
          precioOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          categoria: {
            select: {
              id: true,
              nombre: true,
            },
          },
          creadoEn: true,
        },
        orderBy: [
          { destacado: 'desc' }, // Destacados primero
          { ordenMarketplace: 'asc' }, // Orden personalizado
          { enOferta: 'desc' }, // Ofertas después
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
        precio: true,
        precioCosto: true,
        stock: true,
        stockMinimo: true,
        imagenes: true,
        peso: true,
        dimensiones: true,
        categoria: {
          select: {
            id: true,
            nombre: true,
          },
        },
        marca: {
          select: {
            id: true,
            nombre: true,
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
        detalles: true,
        precio: true,
        precioPorHora: true,
        duracionMinutos: true,
        duracionHoras: true,
        requiereReserva: true,
        requiereDeposito: true,
        depositoPorcentaje: true,
        imagenes: true,
        videoUrl: true,
        categoria: {
          select: {
            id: true,
            nombre: true,
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
