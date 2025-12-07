import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ActivarCategoriaDto {
  empresaId: string;
  categoriaMaestraId?: string;
  nombrePersonalizado?: string;
  descripcionPersonalizada?: string;
  nombreLocal?: string;
  orden?: number;
}

interface ActivarMarcaDto {
  empresaId: string;
  marcaMaestraId?: string;
  nombrePersonalizado?: string;
  descripcionPersonalizada?: string;
  nombreLocal?: string;
  orden?: number;
}

@Injectable()
export class CatalogosService {
  private readonly logger = new Logger(CatalogosService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================
  // CATEGORÍAS MAESTRAS
  // ============================================

  /**
   * Listar todas las categorías maestras (catálogo global)
   */
  async getCategoriasMaestras(opciones?: {
    incluirHijos?: boolean;
    soloPopulares?: boolean;
    soloActivas?: boolean;
  }) {
    const where: any = {};

    if (opciones?.soloActivas !== false) {
      where.isActive = true;
    }

    if (opciones?.soloPopulares) {
      where.esPopular = true;
    }

    return await this.prisma.categoriaMaestra.findMany({
      where,
      include: {
        hijos: opciones?.incluirHijos
          ? {
              where: { isActive: true },
              orderBy: { orden: 'asc' },
            }
          : undefined,
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
  }

  /**
   * Listar categorías disponibles para una empresa
   * (Maestras + Personalizadas activas)
   */
  async getCategoriasDisponiblesParaEmpresa(empresaId: string) {
    // Obtener categorías ya activadas por la empresa
    const categoriasEmpresa = await this.prisma.empresaCategoria.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        categoriaMaestra: true,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });

    // Devolver entidad completa para que Flutter pueda usar sus getters
    return categoriasEmpresa.map((ec) => ({
      id: ec.id,
      empresaId: ec.empresaId,
      categoriaMaestraId: ec.categoriaMaestraId,
      nombrePersonalizado: ec.nombrePersonalizado,
      descripcionPersonalizada: ec.descripcionPersonalizada,
      padreId: ec.padreId,
      nombreLocal: ec.nombreLocal,
      orden: ec.orden,
      isVisible: ec.isVisible,
      isActive: ec.isActive,
      deletedAt: ec.deletedAt,
      creadoEn: ec.creadoEn,
      actualizadoEn: ec.actualizadoEn,
      categoriaMaestra: ec.categoriaMaestra,
    }));
  }

  /**
   * Activar una categoría maestra para una empresa
   * O crear una categoría personalizada
   */
  async activarCategoriaParaEmpresa(dto: ActivarCategoriaDto) {
    const { empresaId, categoriaMaestraId, nombrePersonalizado } = dto;

    // Validar que sea categoría maestra O personalizada
    if (!categoriaMaestraId && !nombrePersonalizado) {
      throw new BadRequestException(
        'Debe proporcionar categoriaMaestraId o nombrePersonalizado',
      );
    }

    // Ejecutar en transacción para evitar race conditions
    const empresaCategoria = await this.prisma.$transaction(async (prisma) => {
      // Si es categoría maestra, verificar que existe
      if (categoriaMaestraId) {
        const maestraExists = await prisma.categoriaMaestra.findUnique({
          where: { id: categoriaMaestraId },
        });

        if (!maestraExists) {
          throw new NotFoundException('Categoría maestra no encontrada');
        }

        // Verificar si ya está activada
        const yaActivada = await prisma.empresaCategoria.findUnique({
          where: {
            empresaId_categoriaMaestraId: {
              empresaId,
              categoriaMaestraId,
            },
          },
        });

        if (yaActivada && yaActivada.isActive) {
          throw new BadRequestException('Esta categoría ya está activada');
        }

        if (yaActivada && !yaActivada.isActive) {
          // Reactivar
          return await prisma.empresaCategoria.update({
            where: { id: yaActivada.id },
            data: {
              isActive: true,
              deletedAt: null,
              nombreLocal: dto.nombreLocal,
              orden: dto.orden,
            },
          });
        }
      }

      // Crear nueva relación
      return await prisma.empresaCategoria.create({
        data: {
          empresaId,
          categoriaMaestraId,
          nombrePersonalizado,
          descripcionPersonalizada: dto.descripcionPersonalizada,
          nombreLocal: dto.nombreLocal,
          orden: dto.orden,
        },
        include: {
          categoriaMaestra: true,
        },
      });
    });

    this.logger.log(
      `Categoría ${categoriaMaestraId ? 'maestra' : 'personalizada'} activada para empresa ${empresaId}`,
    );

    return empresaCategoria;
  }

  /**
   * Desactivar categoría para una empresa
   */
  async desactivarCategoriaParaEmpresa(
    empresaId: string,
    empresaCategoriaId: string,
  ) {
    const empresaCategoria = await this.prisma.empresaCategoria.findFirst({
      where: {
        id: empresaCategoriaId,
        empresaId,
      },
    });

    if (!empresaCategoria) {
      throw new NotFoundException('Categoría no encontrada para esta empresa');
    }

    // Verificar si tiene productos asociados
    const productosCount = await this.prisma.producto.count({
      where: {
        empresaCategoriaId: empresaCategoriaId,
        isActive: true,
      },
    });

    if (productosCount > 0) {
      throw new BadRequestException(
        `No se puede desactivar. Hay ${productosCount} producto(s) asociado(s)`,
      );
    }

    // Soft delete
    return await this.prisma.empresaCategoria.update({
      where: { id: empresaCategoriaId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }

  // ============================================
  // MARCAS MAESTRAS
  // ============================================

  /**
   * Listar todas las marcas maestras (catálogo global)
   */
  async getMarcasMaestras(opciones?: {
    soloPopulares?: boolean;
    soloActivas?: boolean;
  }) {
    const where: any = {};

    if (opciones?.soloActivas !== false) {
      where.isActive = true;
    }

    if (opciones?.soloPopulares) {
      where.esPopular = true;
    }

    return await this.prisma.marcaMaestra.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Listar marcas disponibles para una empresa
   */
  async getMarcasDisponiblesParaEmpresa(empresaId: string) {
    const marcasEmpresa = await this.prisma.empresaMarca.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        marcaMaestra: true,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });

    // Devolver entidad completa para que Flutter pueda usar sus getters
    return marcasEmpresa.map((em) => ({
      id: em.id,
      empresaId: em.empresaId,
      marcaMaestraId: em.marcaMaestraId,
      nombrePersonalizado: em.nombrePersonalizado,
      descripcionPersonalizada: em.descripcionPersonalizada,
      logoPersonalizado: em.logoPersonalizado,
      sitioWebPersonalizado: em.sitioWebPersonalizado,
      nombreLocal: em.nombreLocal,
      orden: em.orden,
      isVisible: em.isVisible,
      isActive: em.isActive,
      deletedAt: em.deletedAt,
      creadoEn: em.creadoEn,
      actualizadoEn: em.actualizadoEn,
      marcaMaestra: em.marcaMaestra,
    }));
  }

  /**
   * Activar una marca maestra para una empresa
   */
  async activarMarcaParaEmpresa(dto: ActivarMarcaDto) {
    const { empresaId, marcaMaestraId, nombrePersonalizado } = dto;

    if (!marcaMaestraId && !nombrePersonalizado) {
      throw new BadRequestException(
        'Debe proporcionar marcaMaestraId o nombrePersonalizado',
      );
    }

    // Ejecutar en transacción para evitar race conditions
    const empresaMarca = await this.prisma.$transaction(async (prisma) => {
      if (marcaMaestraId) {
        const maestraExists = await prisma.marcaMaestra.findUnique({
          where: { id: marcaMaestraId },
        });

        if (!maestraExists) {
          throw new NotFoundException('Marca maestra no encontrada');
        }

        const yaActivada = await prisma.empresaMarca.findUnique({
          where: {
            empresaId_marcaMaestraId: {
              empresaId,
              marcaMaestraId,
            },
          },
        });

        if (yaActivada && yaActivada.isActive) {
          throw new BadRequestException('Esta marca ya está activada');
        }

        if (yaActivada && !yaActivada.isActive) {
          return await prisma.empresaMarca.update({
            where: { id: yaActivada.id },
            data: {
              isActive: true,
              deletedAt: null,
              nombreLocal: dto.nombreLocal,
              orden: dto.orden,
            },
          });
        }
      }

      return await prisma.empresaMarca.create({
        data: {
          empresaId,
          marcaMaestraId,
          nombrePersonalizado,
          descripcionPersonalizada: dto.descripcionPersonalizada,
          nombreLocal: dto.nombreLocal,
          orden: dto.orden,
        },
        include: {
          marcaMaestra: true,
        },
      });
    });

    this.logger.log(
      `Marca ${marcaMaestraId ? 'maestra' : 'personalizada'} activada para empresa ${empresaId}`,
    );

    return empresaMarca;
  }

  /**
   * Desactivar marca para una empresa
   */
  async desactivarMarcaParaEmpresa(empresaId: string, empresaMarcaId: string) {
    const empresaMarca = await this.prisma.empresaMarca.findFirst({
      where: {
        id: empresaMarcaId,
        empresaId,
      },
    });

    if (!empresaMarca) {
      throw new NotFoundException('Marca no encontrada para esta empresa');
    }

    const productosCount = await this.prisma.producto.count({
      where: {
        empresaMarcaId: empresaMarcaId,
        isActive: true,
      },
    });

    if (productosCount > 0) {
      throw new BadRequestException(
        `No se puede desactivar. Hay ${productosCount} producto(s) asociado(s)`,
      );
    }

    return await this.prisma.empresaMarca.update({
      where: { id: empresaMarcaId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }

  // ============================================
  // ACTIVACIÓN MASIVA
  // ============================================

  /**
   * Activar múltiples categorías populares automáticamente
   * (útil al crear una nueva empresa)
   */
  async activarCategoriasPopularesParaEmpresa(empresaId: string) {
    const populares = await this.prisma.categoriaMaestra.findMany({
      where: {
        esPopular: true,
        isActive: true,
      },
    });

    const activadas = [];

    for (const cat of populares) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        activadas.push(activada);
      } catch (error) {
        // Si ya existe, continuar
        if (error.message !== 'Esta categoría ya está activada') {
          throw error;
        }
      }
    }

    this.logger.log(
      `${activadas.length} categorías populares activadas para empresa ${empresaId}`,
    );

    return activadas;
  }

  /**
   * Activar múltiples marcas populares automáticamente
   */
  async activarMarcasPopularesParaEmpresa(empresaId: string) {
    const populares = await this.prisma.marcaMaestra.findMany({
      where: {
        esPopular: true,
        isActive: true,
      },
    });

    const activadas = [];

    for (const marca of populares) {
      try {
        const activada = await this.activarMarcaParaEmpresa({
          empresaId,
          marcaMaestraId: marca.id,
        });
        activadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta marca ya está activada') {
          throw error;
        }
      }
    }

    this.logger.log(
      `${activadas.length} marcas populares activadas para empresa ${empresaId}`,
    );

    return activadas;
  }

  // ============================================
  // ACTIVACIÓN POR RUBRO
  // ============================================

  /**
   * Activar catálogos del rubro tecnológico automáticamente
   * Se usa al crear una nueva empresa que operará en el sector tecnología
   */
  async activarCatalogosRubroTecnologico(empresaId: string) {
    this.logger.log(
      `Activando catálogos del rubro tecnológico para empresa ${empresaId}`,
    );

    // Slugs de categorías tecnológicas (deben coincidir con el seed)
    const categoriasTech = [
      'electronica',
      'smartphones',
      'laptops-computadoras',
      'tablets',
      'audio-video',
      'televisores',
      'camaras',
      'gaming',
      'smartwatches',
      'componentes-pc',
      'almacenamiento',
      'redes',
      'impresoras',
      'software',
      'accesorios-electronicos',
    ];

    // Obtener categorías tecnológicas
    const categoriasMaestras = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriasTech },
        isActive: true,
      },
    });

    // Slugs de marcas tecnológicas
    const marcasTech = [
      'apple',
      'samsung',
      'xiaomi',
      'sony',
      'lg',
      'huawei',
      'microsoft',
      'dell',
      'hp',
      'lenovo',
      'asus',
      'acer',
      'canon',
      'nikon',
      'bose',
      'jbl',
      'panasonic',
      'philips',
    ];

    // Obtener marcas tecnológicas
    const marcasMaestras = await this.prisma.marcaMaestra.findMany({
      where: {
        slug: { in: marcasTech },
        isActive: true,
      },
    });

    const categoriasActivadas = [];
    const marcasActivadas = [];

    // Activar categorías
    for (const cat of categoriasMaestras) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        categoriasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta categoría ya está activada') {
          this.logger.warn(
            `Error activando categoría ${cat.nombre}: ${error.message}`,
          );
        }
      }
    }

    // Activar marcas
    for (const marca of marcasMaestras) {
      try {
        const activada = await this.activarMarcaParaEmpresa({
          empresaId,
          marcaMaestraId: marca.id,
        });
        marcasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta marca ya está activada') {
          this.logger.warn(
            `Error activando marca ${marca.nombre}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Rubro tecnológico activado: ${categoriasActivadas.length} categorías y ${marcasActivadas.length} marcas`,
    );

    return {
      categorias: categoriasActivadas,
      marcas: marcasActivadas,
      total: categoriasActivadas.length + marcasActivadas.length,
    };
  }

  /**
   * Activar catálogos del rubro gastronomía
   */
  async activarCatalogosRubroGastronomia(empresaId: string) {
    this.logger.log(
      `Activando catálogos del rubro gastronomía para empresa ${empresaId}`,
    );

    const categoriasGastronomia = [
      'alimentos',
      'bebidas',
      'postres',
      'panaderia',
      'carnes',
      'lacteos',
      'frutas-verduras',
      'comida-rapida',
      'restaurant-equipamiento',
      'bar',
    ];

    const categoriasMaestras = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriasGastronomia },
        isActive: true,
      },
    });

    const categoriasActivadas = [];

    for (const cat of categoriasMaestras) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        categoriasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta categoría ya está activada') {
          this.logger.warn(
            `Error activando categoría ${cat.nombre}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Rubro gastronomía activado: ${categoriasActivadas.length} categorías`,
    );

    return {
      categorias: categoriasActivadas,
      marcas: [],
      total: categoriasActivadas.length,
    };
  }

  /**
   * Activar catálogos del rubro moda
   */
  async activarCatalogosRubroModa(empresaId: string) {
    this.logger.log(
      `Activando catálogos del rubro moda para empresa ${empresaId}`,
    );

    const categoriasModa = [
      'ropa',
      'calzado',
      'accesorios',
      'joyeria',
      'relojes',
      'bolsos',
      'ropa-hombre',
      'ropa-mujer',
      'ropa-ninos',
      'deportiva',
    ];

    const marcasModa = [
      'nike',
      'adidas',
      'zara',
      'h&m',
      'gucci',
      'puma',
      'reebok',
    ];

    const categoriasMaestras = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriasModa },
        isActive: true,
      },
    });

    const marcasMaestras = await this.prisma.marcaMaestra.findMany({
      where: {
        slug: { in: marcasModa },
        isActive: true,
      },
    });

    const categoriasActivadas = [];
    const marcasActivadas = [];

    for (const cat of categoriasMaestras) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        categoriasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta categoría ya está activada') {
          this.logger.warn(
            `Error activando categoría ${cat.nombre}: ${error.message}`,
          );
        }
      }
    }

    for (const marca of marcasMaestras) {
      try {
        const activada = await this.activarMarcaParaEmpresa({
          empresaId,
          marcaMaestraId: marca.id,
        });
        marcasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta marca ya está activada') {
          this.logger.warn(
            `Error activando marca ${marca.nombre}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Rubro moda activado: ${categoriasActivadas.length} categorías y ${marcasActivadas.length} marcas`,
    );

    return {
      categorias: categoriasActivadas,
      marcas: marcasActivadas,
      total: categoriasActivadas.length + marcasActivadas.length,
    };
  }

  /**
   * Activar catálogos del rubro hogar
   */
  async activarCatalogosRubroHogar(empresaId: string) {
    this.logger.log(
      `Activando catálogos del rubro hogar para empresa ${empresaId}`,
    );

    const categoriasHogar = [
      'muebles',
      'decoracion',
      'electrodomesticos',
      'cocina',
      'bano',
      'jardin',
      'iluminacion',
      'textiles-hogar',
    ];

    const categoriasMaestras = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriasHogar },
        isActive: true,
      },
    });

    const categoriasActivadas = [];

    for (const cat of categoriasMaestras) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        categoriasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta categoría ya está activada') {
          this.logger.warn(
            `Error activando categoría ${cat.nombre}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Rubro hogar activado: ${categoriasActivadas.length} categorías`,
    );

    return {
      categorias: categoriasActivadas,
      marcas: [],
      total: categoriasActivadas.length,
    };
  }

  /**
   * Activar catálogos del rubro salud
   */
  async activarCatalogosRubroSalud(empresaId: string) {
    this.logger.log(
      `Activando catálogos del rubro salud para empresa ${empresaId}`,
    );

    const categoriasSalud = [
      'farmacia',
      'cosmetica',
      'cuidado-personal',
      'suplementos',
      'equipamiento-medico',
      'belleza',
    ];

    const categoriasMaestras = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriasSalud },
        isActive: true,
      },
    });

    const categoriasActivadas = [];

    for (const cat of categoriasMaestras) {
      try {
        const activada = await this.activarCategoriaParaEmpresa({
          empresaId,
          categoriaMaestraId: cat.id,
        });
        categoriasActivadas.push(activada);
      } catch (error) {
        if (error.message !== 'Esta categoría ya está activada') {
          this.logger.warn(
            `Error activando categoría ${cat.nombre}: ${error.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Rubro salud activado: ${categoriasActivadas.length} categorías`,
    );

    return {
      categorias: categoriasActivadas,
      marcas: [],
      total: categoriasActivadas.length,
    };
  }

  /**
   * Activar catálogos según el rubro de la empresa
   * Método orquestador que delega a métodos específicos
   */
  async activarCatalogosSegunRubro(empresaId: string, rubro: string) {
    this.logger.log(
      `Activando catálogos para empresa ${empresaId} del rubro: ${rubro}`,
    );

    switch (rubro.toUpperCase()) {
      case 'TECNOLOGIA':
        return await this.activarCatalogosRubroTecnologico(empresaId);

      case 'GASTRONOMIA':
        return await this.activarCatalogosRubroGastronomia(empresaId);

      case 'MODA':
        return await this.activarCatalogosRubroModa(empresaId);

      case 'HOGAR':
        return await this.activarCatalogosRubroHogar(empresaId);

      case 'SALUD':
        return await this.activarCatalogosRubroSalud(empresaId);

      case 'AUTOMOTRIZ':
      case 'DEPORTES':
      case 'CONSTRUCCION':
      case 'EDUCACION':
      case 'OTRO':
        // Para estos rubros, activar catálogos populares generales
        this.logger.log(
          `Rubro ${rubro} no tiene catálogos específicos, usando populares generales`,
        );
        const categorias = await this.activarCategoriasPopularesParaEmpresa(
          empresaId,
        );
        const marcas = await this.activarMarcasPopularesParaEmpresa(empresaId);
        return {
          categorias,
          marcas,
          total: categorias.length + marcas.length,
        };

      default:
        this.logger.warn(`Rubro desconocido: ${rubro}, sin activación automática`);
        return { categorias: [], marcas: [], total: 0 };
    }
  }

  /**
   * Obtener preview de catálogos que se activarían para un rubro
   * Útil para mostrar al usuario antes de crear la empresa
   */
  async getPreviewCatalogosPorRubro(rubro: string) {
    this.logger.log(`Obteniendo preview de catálogos para rubro: ${rubro}`);

    // Definir slugs por rubro
    let categoriaSlugs: string[] = [];
    let marcaSlugs: string[] = [];

    switch (rubro.toUpperCase()) {
      case 'TECNOLOGIA':
        categoriaSlugs = [
          'electronica',
          'smartphones',
          'laptops-computadoras',
          'tablets',
          'audio-video',
          'televisores',
          'camaras',
          'gaming',
          'smartwatches',
          'componentes-pc',
          'almacenamiento',
          'redes',
          'impresoras',
          'software',
          'accesorios-electronicos',
        ];
        marcaSlugs = [
          'apple',
          'samsung',
          'xiaomi',
          'sony',
          'lg',
          'huawei',
          'microsoft',
          'dell',
          'hp',
          'lenovo',
          'asus',
          'canon',
          'nikon',
          'bose',
          'jbl',
          'panasonic',
          'philips',
        ];
        break;

      case 'MODA':
        categoriaSlugs = [
          'ropa-hombre',
          'ropa-mujer',
          'ropa-ninos',
          'calzado',
          'accesorios-moda',
        ];
        marcaSlugs = ['nike', 'adidas', 'zara', 'puma', 'reebok'];
        break;

      case 'GASTRONOMIA':
        categoriaSlugs = [
          'alimentos-bebidas',
        ];
        marcaSlugs = [];
        break;

      case 'HOGAR':
        categoriaSlugs = ['hogar-jardin'];
        marcaSlugs = ['ikea', 'philips', 'panasonic', 'whirlpool'];
        break;

      case 'SALUD':
        categoriaSlugs = ['belleza-salud'];
        marcaSlugs = ['loreal', 'nivea', 'dove'];
        break;

      case 'DEPORTES':
      case 'AUTOMOTRIZ':
      case 'CONSTRUCCION':
      case 'EDUCACION':
      case 'OTRO':
        // Para estos rubros, usar catálogos populares
        const categoriasPopulares = await this.prisma.categoriaMaestra.findMany({
          where: { esPopular: true, isActive: true },
          select: { id: true, nombre: true, slug: true, icono: true, descripcion: true },
        });
        const marcasPopulares = await this.prisma.marcaMaestra.findMany({
          where: { esPopular: true, isActive: true },
          select: { id: true, nombre: true, slug: true, logo: true, descripcion: true },
        });
        return {
          rubro,
          categorias: categoriasPopulares,
          marcas: marcasPopulares,
          total: categoriasPopulares.length + marcasPopulares.length,
        };

      default:
        return { rubro, categorias: [], marcas: [], total: 0 };
    }

    // Obtener categorías maestras que coincidan con los slugs
    const categorias = await this.prisma.categoriaMaestra.findMany({
      where: {
        slug: { in: categoriaSlugs },
        isActive: true,
      },
      select: {
        id: true,
        nombre: true,
        slug: true,
        icono: true,
        descripcion: true,
      },
      orderBy: { orden: 'asc' },
    });

    // Obtener marcas maestras que coincidan con los slugs
    const marcas = await this.prisma.marcaMaestra.findMany({
      where: {
        slug: { in: marcaSlugs },
        isActive: true,
      },
      select: {
        id: true,
        nombre: true,
        slug: true,
        logo: true,
        descripcion: true,
      },
      orderBy: { nombre: 'asc' },
    });

    return {
      rubro,
      categorias,
      marcas,
      total: categorias.length + marcas.length,
    };
  }
}
