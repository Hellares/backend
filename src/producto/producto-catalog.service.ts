import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CacheService } from '../redis/cache.service';
import { AppLoggerService } from '../common/logger/logger.service';
import {
  QueryProductoDto,
  OrdenProducto,
} from './dto/query-producto.dto';
import { ProductoResponseDto } from './dto/producto-response.dto';

/**
 * Servicio especializado para el catálogo de productos
 * Responsabilidades:
 * - Información base del producto
 * - Validaciones de categoría/marca
 * - Generación de códigos únicos (transacciones críticas)
 * - Gestión de imágenes
 * - Transformación a DTOs
 * - Construcción de queries
 */
@Injectable()
export class ProductoCatalogService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoCatalogService.name);
  }

  // =====================================================
  // VALIDACIONES
  // =====================================================

  /**
   * Valida que una categoría pertenece a la empresa
   */
  async validateEmpresaCategoria(
    empresaCategoriaId: string,
    empresaId: string,
  ) {
    const categoria = await this.prisma.empresaCategoria.findFirst({
      where: {
        id: empresaCategoriaId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!categoria) {
      throw new BadRequestException(
        'La categoría no existe o no pertenece a esta empresa',
      );
    }

    return categoria;
  }

  /**
   * Valida que una marca pertenece a la empresa
   */
  async validateEmpresaMarca(
    empresaMarcaId: string,
    empresaId: string,
  ) {
    const marca = await this.prisma.empresaMarca.findFirst({
      where: {
        id: empresaMarcaId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!marca) {
      throw new BadRequestException(
        'La marca no existe o no pertenece a esta empresa',
      );
    }

    return marca;
  }

  // =====================================================
  // GENERACIÓN DE CÓDIGOS - MIGRADO A ConfiguracionCodigosService
  // =====================================================

  /**
   * NOTA: Los métodos generateCodigos() y generateCodigoVariante()
   * han sido movidos a ConfiguracionCodigosService para centralizar
   * toda la lógica de generación de códigos.
   *
   * Usar: configCodigosService.generarCodigoProducto()
   *       configCodigosService.generarCodigoVariante()
   */

  // =====================================================
  // GESTIÓN DE IMÁGENES
  // =====================================================

  /**
   * Asocia imágenes existentes a un producto
   */
  async asociarImagenes(
    productoId: string,
    empresaId: string,
    imagenesIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    await prisma.archivo.updateMany({
      where: {
        id: { in: imagenesIds },
        empresaId,
      },
      data: {
        entidadTipo: 'PRODUCTO',
        entidadId: productoId,
      },
    });
  }

  /**
   * Actualiza las imágenes de un producto
   * Desasocia las anteriores y asocia las nuevas
   */
  async actualizarImagenes(
    productoId: string,
    empresaId: string,
    imagenesIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    // Desasociar imágenes anteriores
    await prisma.archivo.updateMany({
      where: {
        empresaId,
        entidadTipo: 'PRODUCTO',
        entidadId: productoId,
      },
      data: {
        entidadId: null,
      },
    });

    // Asociar nuevas imágenes
    if (imagenesIds.length > 0) {
      await this.asociarImagenes(productoId, empresaId, imagenesIds, tx);
    }
  }

  // =====================================================
  // TRANSFORMACIÓN A DTOs
  // =====================================================

  /**
   * Convierte una entidad Producto a DTO de respuesta
   */
  toResponseDto(producto: any, archivos?: any[]): ProductoResponseDto {
    // Obtener nombre de categoría y marca
    const categoriaNombre =
      producto.empresaCategoria?.nombreLocal ||
      producto.empresaCategoria?.categoriaMaestra?.nombre ||
      producto.empresaCategoria?.nombrePersonalizado ||
      null;

    const marcaNombre =
      producto.empresaMarca?.nombreLocal ||
      producto.empresaMarca?.marcaMaestra?.nombre ||
      producto.empresaMarca?.nombrePersonalizado ||
      null;

    // Calcular stock total si tiene variantes
    let stockTotal = producto.stock;
    if (producto.tieneVariantes && producto.variantes?.length > 0) {
      stockTotal = producto.variantes.reduce(
        (sum: number, variante: any) => sum + variante.stock,
        0,
      );
    }

    // Desestructurar para excluir campos relacionados
    const { empresaCategoria, empresaMarca, empresa, sede, variantes, atributosValores, unidadMedida, ...productoData } = producto;

    return {
      ...productoData,
      stock: stockTotal,
      precio: Number(producto.precio),
      precioCosto: producto.precioCosto
        ? Number(producto.precioCosto)
        : undefined,
      peso: producto.peso ? Number(producto.peso) : undefined,
      precioOferta: producto.precioOferta
        ? Number(producto.precioOferta)
        : undefined,
      // Información de sede (simplificada)
      sede: sede ? {
        id: sede.id,
        nombre: sede.nombre,
      } : null,
      // Información de categoría
      categoria: categoriaNombre
        ? {
            id: producto.empresaCategoria.id,
            nombre: categoriaNombre,
            categoriaMaestraId:
              producto.empresaCategoria.categoriaMaestraId,
            slug: producto.empresaCategoria.categoriaMaestra?.slug,
          }
        : null,
      // Información de marca
      marca: marcaNombre
        ? {
            id: producto.empresaMarca.id,
            nombre: marcaNombre,
            marcaMaestraId: producto.empresaMarca.marcaMaestraId,
            logo: producto.empresaMarca.logoPersonalizado ||
              producto.empresaMarca.marcaMaestra?.logo,
          }
        : null,
      // Información de unidad de medida
      unidadMedida: unidadMedida ? {
        id: unidadMedida.id,
        empresaId: unidadMedida.empresaId,
        unidadMaestraId: unidadMedida.unidadMaestraId,
        nombrePersonalizado: unidadMedida.nombrePersonalizado,
        simboloPersonalizado: unidadMedida.simboloPersonalizado,
        codigoPersonalizado: unidadMedida.codigoPersonalizado,
        descripcion: unidadMedida.descripcion,
        nombreLocal: unidadMedida.nombreLocal,
        simboloLocal: unidadMedida.simboloLocal,
        orden: unidadMedida.orden,
        isVisible: unidadMedida.isVisible,
        isActive: unidadMedida.isActive,
        deletedAt: unidadMedida.deletedAt,
        creadoEn: unidadMedida.creadoEn,
        actualizadoEn: unidadMedida.actualizadoEn,
        unidadMaestra: unidadMedida.unidadMaestra ? {
          id: unidadMedida.unidadMaestra.id,
          codigo: unidadMedida.unidadMaestra.codigo,
          nombre: unidadMedida.unidadMaestra.nombre,
          simbolo: unidadMedida.unidadMaestra.simbolo,
          descripcion: unidadMedida.unidadMaestra.descripcion,
          categoria: unidadMedida.unidadMaestra.categoria,
          esPopular: unidadMedida.unidadMaestra.esPopular,
          orden: unidadMedida.unidadMaestra.orden,
          isActive: unidadMedida.unidadMaestra.isActive,
          creadoEn: unidadMedida.unidadMaestra.creadoEn,
          actualizadoEn: unidadMedida.unidadMaestra.actualizadoEn,
        } : null,
      } : null,
      imagenes: archivos?.map((a) => a.url) || [],
      archivos: archivos?.map((a) => ({
        id: a.id,
        url: a.url,
        urlThumbnail: a.urlThumbnail,
        categoria: a.categoria,
        orden: a.orden,
      })),
      // Atributos estructurados del producto base (solo si no tiene variantes)
      atributosValores: atributosValores?.map((av: any) => ({
        id: av.id,
        atributoId: av.atributoId,
        valor: av.valor,
        atributo: {
          id: av.atributo.id,
          nombre: av.atributo.nombre,
          clave: av.atributo.clave,
          tipo: av.atributo.tipo,
          unidad: av.atributo.unidad,
        },
      })) || [],
      // Información de variantes con atributos estructurados
      variantes: variantes?.map((v: any) => ({
        id: v.id,
        nombre: v.nombre,
        sku: v.sku,
        atributosValores: v.atributosValores?.map((av: any) => ({
          id: av.id,
          atributoId: av.atributoId,
          valor: av.valor,
          atributo: {
            id: av.atributo.id,
            nombre: av.atributo.nombre,
            clave: av.atributo.clave,
            tipo: av.atributo.tipo,
            unidad: av.atributo.unidad,
          },
        })) || [],
        precio: Number(v.precio),
        stock: v.stock,
        isActive: v.isActive,
        orden: v.orden,
      })),
    };
  }

  // =====================================================
  // CONSTRUCCIÓN DE QUERIES
  // =====================================================

  /**
   * Convierte el enum de orden a objeto de ordenamiento de Prisma
   */
  getOrderBy(orden?: OrdenProducto) {
    switch (orden) {
      case OrdenProducto.NOMBRE_ASC:
        return { nombre: 'asc' as const };
      case OrdenProducto.NOMBRE_DESC:
        return { nombre: 'desc' as const };
      case OrdenProducto.PRECIO_ASC:
        return { precio: 'asc' as const };
      case OrdenProducto.PRECIO_DESC:
        return { precio: 'desc' as const };
      case OrdenProducto.STOCK_ASC:
        return { stock: 'asc' as const };
      case OrdenProducto.STOCK_DESC:
        return { stock: 'desc' as const };
      case OrdenProducto.ANTIGUOS:
        return { creadoEn: 'asc' as const };
      case OrdenProducto.RECIENTES:
      default:
        return { creadoEn: 'desc' as const };
    }
  }

  /**
   * Construye la cláusula WHERE para filtrado de productos
   */
  buildWhereClause(empresaId: string, filters: QueryProductoDto): Prisma.ProductoWhereInput {
    const where: Prisma.ProductoWhereInput = {
      empresaId,
      deletedAt: null,
    };

    // Búsqueda por texto
    if (filters.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: 'insensitive' } },
        { descripcion: { contains: filters.search, mode: 'insensitive' } },
        { codigoEmpresa: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
        { codigoBarras: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Filtros específicos
    if (filters.empresaCategoriaId) {
      where.empresaCategoriaId = filters.empresaCategoriaId;
    }

    if (filters.empresaMarcaId) {
      where.empresaMarcaId = filters.empresaMarcaId;
    }

    if (filters.sedeId) {
      where.sedeId = filters.sedeId;
    }

    if (filters.visibleMarketplace !== undefined) {
      where.visibleMarketplace = filters.visibleMarketplace;
    }

    if (filters.enOferta === true) {
      where.enOferta = true;
      where.fechaFinOferta = {
        gte: new Date(), // Ofertas no expiradas
      };
    }

    if (filters.stockBajo === true) {
      where.stock = {
        lte: this.prisma.producto.fields.stockMinimo,
      };
    }

    // Filtrar solo productos simples (excluye combos)
    if (filters.soloProductos === true) {
      where.esCombo = false;
    }

    // Filtrar solo combos
    if (filters.soloCombos === true) {
      where.esCombo = true;
    }

    return where;
  }

  /**
   * Construye la cláusula INCLUDE para relaciones
   */
  buildIncludeClause(
    includeVariantes: boolean = false,
    includeAtributos: boolean = false,
    includeArchivos: boolean = false,
  ): Prisma.ProductoInclude {
    const include: Prisma.ProductoInclude = {
      empresaCategoria: {
        include: {
          categoriaMaestra: {
            select: {
              nombre: true,
              slug: true,
            },
          },
        },
      },
      empresaMarca: {
        include: {
          marcaMaestra: {
            select: {
              nombre: true,
              logo: true,
            },
          },
        },
      },
      sede: {
        select: {
          id: true,
          nombre: true,
        },
      },
      unidadMedida: {
        include: {
          unidadMaestra: {
            select: {
              id: true,
              codigo: true,
              nombre: true,
              simbolo: true,
              descripcion: true,
              categoria: true,
              esPopular: true,
              orden: true,
              isActive: true,
              creadoEn: true,
              actualizadoEn: true,
            },
          },
        },
      },
    };

    if (includeVariantes) {
      const varianteInclude: any = {
        unidadMedida: {
          include: {
            unidadMaestra: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                simbolo: true,
                descripcion: true,
                categoria: true,
                esPopular: true,
                orden: true,
                isActive: true,
                creadoEn: true,
                actualizadoEn: true,
              },
            },
          },
        },
      };

      if (includeAtributos) {
        varianteInclude.atributosValores = {
          include: {
            atributo: true,
          },
        };
      }

      include.variantes = {
        where: {
          deletedAt: null,
        },
        include: varianteInclude,
        orderBy: {
          orden: 'asc',
        },
      };
    }

    if (includeAtributos) {
      include.atributosValores = {
        include: {
          atributo: true,
        },
      };
    }

    return include;
  }

  // =====================================================
  // ARCHIVOS / IMÁGENES
  // =====================================================

  /**
   * Obtener archivos de un producto
   * Helper para evitar duplicación de código
   */
  async getProductoArchivos(
    productoId: string,
    empresaId: string,
  ): Promise<any[]> {
    return await this.prisma.archivo.findMany({
      where: {
        empresaId,
        entidadTipo: 'PRODUCTO',
        entidadId: productoId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });
  }
}
