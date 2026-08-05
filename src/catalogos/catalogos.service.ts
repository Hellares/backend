import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TextoBusquedaService } from '../producto/texto-busqueda.service';

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

  constructor(
    private prisma: PrismaService,
    private textoBusqueda: TextoBusquedaService,
  ) {}

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

    // Reactivar puede cambiar el `nombreLocal`, y ese nombre está COPIADO
    // dentro del `textoBusqueda` de cada producto de la categoría: sin
    // rehacerlo seguirían encontrándose por el nombre viejo. Si la categoría
    // es nueva no tiene productos y el UPDATE no toca ninguna fila.
    await this.textoBusqueda.recalcularPorCategoria(empresaCategoria.id);

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

    // Mismo motivo que en categorías: el nombre de la marca viaja copiado
    // dentro del textoBusqueda de sus productos.
    await this.textoBusqueda.recalcularPorMarca(empresaMarca.id);

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
   * Activar múltiples categorías populares automáticamente (versión bulk)
   * Usa createMany + skipDuplicates en lugar de loop individual
   */
  async activarCategoriasPopularesParaEmpresa(empresaId: string) {
    const populares = await this.prisma.categoriaMaestra.findMany({
      where: { esPopular: true, isActive: true },
    });

    if (populares.length === 0) return [];

    await this.prisma.empresaCategoria.createMany({
      data: populares.map((cat, i) => ({
        empresaId,
        categoriaMaestraId: cat.id,
        orden: i,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `${populares.length} categorías populares activadas en bulk para empresa ${empresaId}`,
    );

    return populares;
  }

  /**
   * Activar múltiples marcas populares automáticamente (versión bulk)
   * Usa createMany + skipDuplicates en lugar de loop individual
   */
  async activarMarcasPopularesParaEmpresa(empresaId: string) {
    const populares = await this.prisma.marcaMaestra.findMany({
      where: { esPopular: true, isActive: true },
    });

    if (populares.length === 0) return [];

    await this.prisma.empresaMarca.createMany({
      data: populares.map((marca, i) => ({
        empresaId,
        marcaMaestraId: marca.id,
        orden: i,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `${populares.length} marcas populares activadas en bulk para empresa ${empresaId}`,
    );

    return populares;
  }

  // ============================================
  // ACTIVACIÓN POR RUBRO (BULK OPTIMIZADO)
  // ============================================

  /** Configuración de slugs de catálogos por rubro */
  private static readonly CATALOGOS_POR_RUBRO: Record<
    string,
    { categorias: string[]; marcas: string[] }
  > = {
    TECNOLOGIA: {
      categorias: [
        'electronica', 'smartphones', 'laptops-computadoras', 'tablets',
        'audio-video', 'televisores', 'camaras', 'gaming', 'smartwatches',
        'componentes-pc', 'almacenamiento', 'redes', 'impresoras',
        'software', 'accesorios-electronicos',
      ],
      marcas: [
        'apple', 'samsung', 'xiaomi', 'sony', 'lg', 'huawei', 'microsoft',
        'dell', 'hp', 'lenovo', 'asus', 'acer', 'canon', 'nikon', 'bose',
        'jbl', 'panasonic', 'philips',
      ],
    },
    GASTRONOMIA: {
      categorias: [
        'alimentos', 'bebidas', 'postres', 'panaderia', 'carnes',
        'lacteos', 'frutas-verduras', 'comida-rapida', 'restaurant-equipamiento', 'bar',
      ],
      marcas: [],
    },
    MODA: {
      categorias: [
        'ropa', 'calzado', 'accesorios', 'joyeria', 'relojes', 'bolsos',
        'ropa-hombre', 'ropa-mujer', 'ropa-ninos', 'deportiva',
      ],
      marcas: ['nike', 'adidas', 'zara', 'h&m', 'gucci', 'puma', 'reebok'],
    },
    HOGAR: {
      categorias: [
        'muebles', 'decoracion', 'electrodomesticos', 'cocina', 'bano',
        'jardin', 'iluminacion', 'textiles-hogar',
      ],
      marcas: [],
    },
    SALUD: {
      categorias: [
        'farmacia', 'cosmetica', 'cuidado-personal', 'suplementos',
        'equipamiento-medico', 'belleza',
      ],
      marcas: [],
    },
  };

  /**
   * Rubros sin catálogo propio: arrancan con las categorías y marcas populares.
   * ⚠️ Junto con las claves de CATALOGOS_POR_RUBRO tiene que cubrir el enum
   * RubroEmpresa COMPLETO. Un rubro que no esté en ninguno de los dos crea la
   * empresa con CERO categorías y CERO marcas, sin error visible.
   */
  private static readonly RUBROS_GENERICOS = [
    'AUTOMOTRIZ', 'DEPORTES', 'CONSTRUCCION', 'EDUCACION',
    'BELLEZA', 'MASCOTAS', 'OFICINA', 'ENTRETENIMIENTO', 'OTRO',
  ];

  /**
   * Método bulk optimizado para activar catálogos por slugs
   * Reduce ~100+ queries individuales a ~4 queries con createMany + skipDuplicates
   */
  private async activarCatalogosRubroBulk(
    empresaId: string,
    categorySlugs: string[],
    brandSlugs: string[],
  ) {
    // Fetch maestras en paralelo (2 queries)
    const [categoriasMaestras, marcasMaestras] = await Promise.all([
      categorySlugs.length > 0
        ? this.prisma.categoriaMaestra.findMany({
            where: { slug: { in: categorySlugs }, isActive: true },
          })
        : Promise.resolve([]),
      brandSlugs.length > 0
        ? this.prisma.marcaMaestra.findMany({
            where: { slug: { in: brandSlugs }, isActive: true },
          })
        : Promise.resolve([]),
    ]);

    // Bulk create con skipDuplicates en transacción batch (1-2 queries)
    const txOps: any[] = [];
    if (categoriasMaestras.length > 0) {
      txOps.push(
        this.prisma.empresaCategoria.createMany({
          data: categoriasMaestras.map((cat, i) => ({
            empresaId,
            categoriaMaestraId: cat.id,
            orden: i,
          })),
          skipDuplicates: true,
        }),
      );
    }
    if (marcasMaestras.length > 0) {
      txOps.push(
        this.prisma.empresaMarca.createMany({
          data: marcasMaestras.map((marca, i) => ({
            empresaId,
            marcaMaestraId: marca.id,
            orden: i,
          })),
          skipDuplicates: true,
        }),
      );
    }

    if (txOps.length > 0) {
      await this.prisma.$transaction(txOps);
    }

    return {
      categorias: categoriasMaestras,
      marcas: marcasMaestras,
      total: categoriasMaestras.length + marcasMaestras.length,
    };
  }

  /**
   * Activar catálogos según el rubro de la empresa (versión bulk optimizada)
   * Reduce ~100+ queries individuales a ~4 queries con createMany
   */
  async activarCatalogosSegunRubro(empresaId: string, rubro: string) {
    this.logger.log(
      `Activando catálogos para empresa ${empresaId} del rubro: ${rubro}`,
    );

    const rubroKey = rubro.toUpperCase();
    const config = CatalogosService.CATALOGOS_POR_RUBRO[rubroKey];

    if (config) {
      this.logger.log(`Activando catálogos del rubro ${rubroKey} para empresa ${empresaId}`);
      const result = await this.activarCatalogosRubroBulk(
        empresaId,
        config.categorias,
        config.marcas,
      );
      this.logger.log(
        `Rubro ${rubroKey} activado: ${result.categorias.length} categorías y ${result.marcas.length} marcas`,
      );
      return result;
    }

    // Rubros sin configuración específica: usar populares generales
    if (CatalogosService.RUBROS_GENERICOS.includes(rubroKey)) {
      this.logger.log(
        `Rubro ${rubro} no tiene catálogos específicos, usando populares generales`,
      );
      const [categorias, marcas] = await Promise.all([
        this.activarCategoriasPopularesParaEmpresa(empresaId),
        this.activarMarcasPopularesParaEmpresa(empresaId),
      ]);
      return {
        categorias,
        marcas,
        total: categorias.length + marcas.length,
      };
    }

    this.logger.warn(`Rubro desconocido: ${rubro}, sin activación automática`);
    return { categorias: [], marcas: [], total: 0 };
  }

  /**
   * Obtener preview de catálogos que se activarían para un rubro
   * Usa la misma configuración de slugs que la activación real
   */
  async getPreviewCatalogosPorRubro(rubro: string) {
    this.logger.log(`Obteniendo preview de catálogos para rubro: ${rubro}`);

    const rubroKey = rubro.toUpperCase();
    const config = CatalogosService.CATALOGOS_POR_RUBRO[rubroKey];

    // Rubros sin config específica: usar populares
    if (!config && CatalogosService.RUBROS_GENERICOS.includes(rubroKey)) {
      const [categoriasPopulares, marcasPopulares] = await Promise.all([
        this.prisma.categoriaMaestra.findMany({
          where: { esPopular: true, isActive: true },
          select: { id: true, nombre: true, slug: true, icono: true, descripcion: true },
        }),
        this.prisma.marcaMaestra.findMany({
          where: { esPopular: true, isActive: true },
          select: { id: true, nombre: true, slug: true, logo: true, descripcion: true },
        }),
      ]);
      return {
        rubro,
        categorias: categoriasPopulares,
        marcas: marcasPopulares,
        total: categoriasPopulares.length + marcasPopulares.length,
      };
    }

    if (!config) {
      return { rubro, categorias: [], marcas: [], total: 0 };
    }

    // Fetch en paralelo usando los mismos slugs que la activación
    const [categorias, marcas] = await Promise.all([
      config.categorias.length > 0
        ? this.prisma.categoriaMaestra.findMany({
            where: { slug: { in: config.categorias }, isActive: true },
            select: { id: true, nombre: true, slug: true, icono: true, descripcion: true },
            orderBy: { orden: 'asc' },
          })
        : Promise.resolve([]),
      config.marcas.length > 0
        ? this.prisma.marcaMaestra.findMany({
            where: { slug: { in: config.marcas }, isActive: true },
            select: { id: true, nombre: true, slug: true, logo: true, descripcion: true },
            orderBy: { nombre: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    return {
      rubro,
      categorias,
      marcas,
      total: categorias.length + marcas.length,
    };
  }

  // ============================================
  // UNIDADES DE MEDIDA MAESTRAS
  // ============================================

  /**
   * Listar todas las unidades de medida maestras (catálogo global SUNAT)
   */
  async getUnidadesMaestras(opciones?: {
    categoria?: string;
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

    if (opciones?.categoria) {
      where.categoria = opciones.categoria;
    }

    return await this.prisma.unidadMedidaMaestra.findMany({
      where,
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
  }

  /**
   * Listar unidades de medida disponibles para una empresa
   * (Ya activadas por la empresa)
   */
  async getUnidadesDisponiblesParaEmpresa(empresaId: string) {
    const unidadesEmpresa = await this.prisma.empresaUnidadMedida.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        unidadMaestra: true,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });

    // Devolver entidad completa para que el frontend pueda usar sus getters
    return unidadesEmpresa.map((eu) => ({
      id: eu.id,
      empresaId: eu.empresaId,
      unidadMaestraId: eu.unidadMaestraId,
      nombrePersonalizado: eu.nombrePersonalizado,
      simboloPersonalizado: eu.simboloPersonalizado,
      codigoPersonalizado: eu.codigoPersonalizado,
      descripcion: eu.descripcion,
      nombreLocal: eu.nombreLocal,
      simboloLocal: eu.simboloLocal,
      orden: eu.orden,
      isVisible: eu.isVisible,
      isActive: eu.isActive,
      deletedAt: eu.deletedAt,
      creadoEn: eu.creadoEn,
      actualizadoEn: eu.actualizadoEn,
      // Datos maestros incluidos
      unidadMaestra: eu.unidadMaestra,
    }));
  }

  /**
   * Activar una unidad de medida maestra para la empresa
   */
  async activarUnidadMedidaParaEmpresa(dto: {
    empresaId: string;
    unidadMaestraId?: string;
    nombrePersonalizado?: string;
    simboloPersonalizado?: string;
    codigoPersonalizado?: string;
    descripcion?: string;
    nombreLocal?: string;
    simboloLocal?: string;
    orden?: number;
  }) {
    // Ejecutar en transacción para evitar race conditions
    return await this.prisma.$transaction(async (prisma) => {
      // Validar que la empresa existe
      const empresa = await prisma.empresa.findUnique({
        where: { id: dto.empresaId },
      });

      if (!empresa) {
        throw new NotFoundException('Empresa no encontrada');
      }

      // Si es una unidad maestra, validar que existe
      if (dto.unidadMaestraId) {
        const unidadMaestra = await prisma.unidadMedidaMaestra.findUnique({
          where: { id: dto.unidadMaestraId },
        });

        if (!unidadMaestra) {
          throw new NotFoundException('Unidad de medida maestra no encontrada');
        }

        // Verificar si ya está activada (dentro de la transacción)
        const existe = await prisma.empresaUnidadMedida.findFirst({
          where: {
            empresaId: dto.empresaId,
            unidadMaestraId: dto.unidadMaestraId,
            deletedAt: null,
          },
        });

        if (existe) {
          throw new BadRequestException('Esta unidad ya está activada');
        }
      } else {
        // Es una unidad personalizada, validar que tiene nombre y símbolo
        if (!dto.nombrePersonalizado || !dto.simboloPersonalizado) {
          throw new BadRequestException(
            'Las unidades personalizadas requieren nombre y símbolo',
          );
        }

        // Validar que no exista otra unidad personalizada con el mismo nombre
        const duplicadoPersonalizado =
          await prisma.empresaUnidadMedida.findFirst({
            where: {
              empresaId: dto.empresaId,
              nombrePersonalizado: dto.nombrePersonalizado,
              deletedAt: null,
            },
          });

        if (duplicadoPersonalizado) {
          throw new BadRequestException(
            'Ya existe una unidad personalizada con ese nombre',
          );
        }
      }

      // Crear la activación
      const unidadActivada = await prisma.empresaUnidadMedida.create({
        data: {
          empresaId: dto.empresaId,
          unidadMaestraId: dto.unidadMaestraId,
          nombrePersonalizado: dto.nombrePersonalizado,
          simboloPersonalizado: dto.simboloPersonalizado,
          codigoPersonalizado: dto.codigoPersonalizado,
          descripcion: dto.descripcion,
          nombreLocal: dto.nombreLocal,
          simboloLocal: dto.simboloLocal,
          orden: dto.orden,
        },
        include: {
          unidadMaestra: true,
        },
      });

      this.logger.log(
        `Unidad de medida ${dto.unidadMaestraId ? 'maestra' : 'personalizada'} activada para empresa ${dto.empresaId}`,
        {
          empresaId: dto.empresaId,
          unidadId: unidadActivada.id,
          tipo: dto.unidadMaestraId ? 'maestra' : 'personalizada',
        },
      );

      return unidadActivada;
    });
  }

  /**
   * Desactivar una unidad de medida para la empresa (soft delete)
   */
  async desactivarUnidadMedidaParaEmpresa(
    id: string,
    empresaId: string,
  ): Promise<void> {
    const unidad = await this.prisma.empresaUnidadMedida.findFirst({
      where: { id, empresaId },
    });

    if (!unidad) {
      throw new NotFoundException('Unidad de medida no encontrada');
    }

    // Verificar que no esté en uso por productos o servicios
    const productosConUnidad = await this.prisma.producto.count({
      where: {
        empresaId,
        unidadMedidaId: id,
        deletedAt: null,
      },
    });

    if (productosConUnidad > 0) {
      throw new BadRequestException(
        `No se puede desactivar la unidad porque está en uso por ${productosConUnidad} producto(s)`,
      );
    }

    const serviciosConUnidad = await this.prisma.servicio.count({
      where: {
        empresaId,
        unidadMedidaId: id,
        deletedAt: null,
      },
    });

    if (serviciosConUnidad > 0) {
      throw new BadRequestException(
        `No se puede desactivar la unidad porque está en uso por ${serviciosConUnidad} servicio(s)`,
      );
    }

    // Soft delete
    await this.prisma.empresaUnidadMedida.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    this.logger.log(
      `Unidad de medida desactivada para empresa ${empresaId}: ${id}`,
    );
  }

  /**
   * Activar unidades de medida más comunes automáticamente (versión bulk)
   * Reduce ~30 queries a ~3 queries usando createMany
   */
  async activarUnidadesPopularesParaEmpresa(empresaId: string) {
    this.logger.log(
      `Activando unidades de medida populares para empresa ${empresaId}`,
    );

    // 1. Fetch unidades populares (1 query)
    const unidadesPopulares = await this.prisma.unidadMedidaMaestra.findMany({
      where: { esPopular: true, isActive: true },
      orderBy: { orden: 'asc' },
    });

    if (unidadesPopulares.length === 0) {
      return { unidades: [], total: 0 };
    }

    // 2. Check existentes en batch (1 query) - para evitar duplicados
    const existentes = await this.prisma.empresaUnidadMedida.findMany({
      where: {
        empresaId,
        unidadMaestraId: { in: unidadesPopulares.map((u) => u.id) },
        deletedAt: null,
      },
      select: { unidadMaestraId: true },
    });
    const existentesIds = new Set(existentes.map((e) => e.unidadMaestraId));
    const nuevas = unidadesPopulares.filter((u) => !existentesIds.has(u.id));

    if (nuevas.length === 0) {
      return { unidades: [], total: 0 };
    }

    // 3. Bulk create (1 query)
    await this.prisma.empresaUnidadMedida.createMany({
      data: nuevas.map((unidad, i) => ({
        empresaId,
        unidadMaestraId: unidad.id,
        orden: i,
      })),
    });

    this.logger.log(
      `${nuevas.length} unidades populares activadas para empresa ${empresaId}`,
    );

    return {
      unidades: nuevas,
      total: nuevas.length,
    };
  }
}
