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

    // Desasociar imágenes anteriores (solo tipo IMAGEN, no tocar videos ni otros)
    await prisma.archivo.updateMany({
      where: {
        empresaId,
        entidadTipo: 'PRODUCTO',
        entidadId: productoId,
        tipoArchivo: 'IMAGEN',
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

    // Calcular stock total desde ProductoStock (sistema multi-sede)
    let stockTotal = 0;
    let stocksPorSede: any[] | undefined = undefined;

    if (producto.stocksPorSede && producto.stocksPorSede.length > 0 && !producto.tieneVariantes) {
      stockTotal = producto.stocksPorSede.reduce(
        (sum: number, stock: any) => {
          const disponible = stock.stockActual
            - (stock.stockReservado || 0)
            - (stock.stockReservadoVenta || 0)
            - (stock.stockReservadoCombo || 0)
            - (stock.stockReservadoCotizacion || 0)
            - (stock.stockDanado || 0)
            - (stock.stockEnGarantia || 0);
          return sum + Math.max(0, disponible);
        },
        0,
      );

      stocksPorSede = producto.stocksPorSede.map((stock: any) => {
        const disponible = stock.stockActual
          - (stock.stockReservado || 0)
          - (stock.stockReservadoVenta || 0)
          - (stock.stockReservadoCombo || 0)
          - (stock.stockReservadoCotizacion || 0)
          - (stock.stockDanado || 0)
          - (stock.stockEnGarantia || 0);
        return {
        sedeId: stock.sede.id,
        sedeNombre: stock.sede.nombre,
        sedeCodigo: stock.sede.codigo,
        cantidad: Math.max(0, disponible),
        stockMinimo: stock.stockMinimo,
        stockMaximo: stock.stockMaximo,
        ubicacion: stock.ubicacion,
        precio: stock.precio ? Number(stock.precio) : null,
        precioCosto: stock.precioCosto ? Number(stock.precioCosto) : null,
        precioOferta: stock.precioOferta ? Number(stock.precioOferta) : null,
        enOferta: stock.enOferta ?? false,
        fechaInicioOferta: stock.fechaInicioOferta,
        fechaFinOferta: stock.fechaFinOferta,
        enLiquidacion: stock.enLiquidacion ?? false,
        precioLiquidacion: stock.precioLiquidacion ? Number(stock.precioLiquidacion) : null,
        fechaInicioLiquidacion: stock.fechaInicioLiquidacion,
        fechaFinLiquidacion: stock.fechaFinLiquidacion,
        precioConfigurado: stock.precioConfigurado ?? false,
        precioIncluyeIgv: stock.precioIncluyeIgv ?? false,
      };
      });
    } else if (producto.tieneVariantes && producto.variantes?.length > 0) {
      // Consolidar stock por sede sumando todas las variantes + stock
      // residual del producto base (puede tener stock de devoluciones
      // de ventas anteriores a la conversión a variantes).
      const sedeMap = new Map<string, any>();

      // Primero: stock residual del producto base (devoluciones pre-variantes)
      if (producto.stocksPorSede) {
        for (const stock of producto.stocksPorSede) {
          if (!stock.stockActual || stock.stockActual <= 0) continue;
          const sid = stock.sede.id;
          const disponible = stock.stockActual
            - (stock.stockReservado || 0)
            - (stock.stockReservadoVenta || 0)
            - (stock.stockReservadoCombo || 0)
            - (stock.stockReservadoCotizacion || 0)
            - (stock.stockDanado || 0)
            - (stock.stockEnGarantia || 0);
          if (disponible > 0) {
            sedeMap.set(sid, {
              sedeId: stock.sede.id,
              sedeNombre: stock.sede.nombre,
              sedeCodigo: stock.sede.codigo,
              cantidad: disponible,
              stockMinimo: null,
              stockMaximo: null,
              ubicacion: null,
              precio: stock.precio ? Number(stock.precio) : null,
              precioCosto: stock.precioCosto ? Number(stock.precioCosto) : null,
              precioOferta: null,
              enOferta: false,
              fechaInicioOferta: null,
              fechaFinOferta: null,
              enLiquidacion: false,
              precioLiquidacion: null,
              fechaInicioLiquidacion: null,
              fechaFinLiquidacion: null,
              precioConfigurado: stock.precioConfigurado ?? false,
              precioIncluyeIgv: stock.precioIncluyeIgv ?? false,
            });
          }
        }
      }

      // Luego: stock de variantes (sobrescribe precios si la sede ya existe)
      for (const variante of producto.variantes) {
        if (!variante.stocksPorSede) continue;
        for (const stock of variante.stocksPorSede) {
          const sid = stock.sede.id;
          const disponible = stock.stockActual
            - (stock.stockReservado || 0)
            - (stock.stockReservadoVenta || 0)
            - (stock.stockReservadoCombo || 0)
            - (stock.stockReservadoCotizacion || 0)
            - (stock.stockDanado || 0)
            - (stock.stockEnGarantia || 0);
          const existing = sedeMap.get(sid);
          if (existing) {
            existing.cantidad += Math.max(0, disponible);
            if (stock.precioConfigurado && stock.precio) {
              existing.precio = Number(stock.precio);
              existing.precioCosto = stock.precioCosto ? Number(stock.precioCosto) : existing.precioCosto;
              existing.precioConfigurado = true;
            }
          } else {
            sedeMap.set(sid, {
              sedeId: stock.sede.id,
              sedeNombre: stock.sede.nombre,
              sedeCodigo: stock.sede.codigo,
              cantidad: Math.max(0, disponible),
              stockMinimo: null,
              stockMaximo: null,
              ubicacion: null,
              precio: stock.precio ? Number(stock.precio) : null,
              precioCosto: stock.precioCosto ? Number(stock.precioCosto) : null,
              precioOferta: stock.precioOferta ? Number(stock.precioOferta) : null,
              enOferta: stock.enOferta ?? false,
              fechaInicioOferta: stock.fechaInicioOferta,
              fechaFinOferta: stock.fechaFinOferta,
              enLiquidacion: stock.enLiquidacion ?? false,
              precioLiquidacion: stock.precioLiquidacion ? Number(stock.precioLiquidacion) : null,
              fechaInicioLiquidacion: stock.fechaInicioLiquidacion,
              fechaFinLiquidacion: stock.fechaFinLiquidacion,
              precioConfigurado: stock.precioConfigurado ?? false,
              precioIncluyeIgv: stock.precioIncluyeIgv ?? false,
            });
          }
        }
      }
      stocksPorSede = Array.from(sedeMap.values());
      stockTotal = stocksPorSede.reduce((sum: number, s: any) => sum + s.cantidad, 0);
    }

    // Desestructurar para excluir campos relacionados
    const { empresaCategoria, empresaMarca, empresa, sede, variantes, atributosValores, unidadMedida, unidadCompra, stocksPorSede: _, ...productoData } = producto;

    // Obtener precio del primer stock con precio configurado
    let precioFinal = 0;
    let precioCostoFinal: number | undefined = undefined;
    let precioOfertaFinal: number | undefined = undefined;

    if (stocksPorSede && stocksPorSede.length > 0) {
      const stockConPrecio = stocksPorSede.find((s: any) => s.precioConfigurado && s.precio != null);
      if (stockConPrecio) {
        precioFinal = stockConPrecio.precio;
        precioCostoFinal = stockConPrecio.precioCosto || undefined;
        precioOfertaFinal = stockConPrecio.precioOferta || undefined;
      }
    }

    return {
      ...productoData,
      stock: stockTotal,
      stocksPorSede: stocksPorSede, // Desglose de stock por sede (si se solicitó)
      precio: precioFinal,
      precioCosto: precioCostoFinal,
      peso: producto.peso ? Number(producto.peso) : undefined,
      precioOferta: precioOfertaFinal,
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
      // Unidad de Compra (mismo shape que unidadMedida para que el
      // modelo de Flutter pueda usar EmpresaUnidadMedidaModel.fromJson
      // sin parsers especiales).
      unidadCompra: unidadCompra ? {
        id: unidadCompra.id,
        empresaId: unidadCompra.empresaId,
        unidadMaestraId: unidadCompra.unidadMaestraId,
        nombrePersonalizado: unidadCompra.nombrePersonalizado,
        simboloPersonalizado: unidadCompra.simboloPersonalizado,
        codigoPersonalizado: unidadCompra.codigoPersonalizado,
        descripcion: unidadCompra.descripcion,
        nombreLocal: unidadCompra.nombreLocal,
        simboloLocal: unidadCompra.simboloLocal,
        orden: unidadCompra.orden,
        isVisible: unidadCompra.isVisible,
        isActive: unidadCompra.isActive,
        deletedAt: unidadCompra.deletedAt,
        creadoEn: unidadCompra.creadoEn,
        actualizadoEn: unidadCompra.actualizadoEn,
        unidadMaestra: unidadCompra.unidadMaestra ? {
          id: unidadCompra.unidadMaestra.id,
          codigo: unidadCompra.unidadMaestra.codigo,
          nombre: unidadCompra.unidadMaestra.nombre,
          simbolo: unidadCompra.unidadMaestra.simbolo,
          descripcion: unidadCompra.unidadMaestra.descripcion,
          categoria: unidadCompra.unidadMaestra.categoria,
          esPopular: unidadCompra.unidadMaestra.esPopular,
          orden: unidadCompra.unidadMaestra.orden,
          isActive: unidadCompra.unidadMaestra.isActive,
          creadoEn: unidadCompra.unidadMaestra.creadoEn,
          actualizadoEn: unidadCompra.unidadMaestra.actualizadoEn,
        } : null,
      } : null,
      factorCompra: producto.factorCompra != null ? Number(producto.factorCompra) : null,
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
      variantes: variantes?.map((v: any) => {
        // Calcular stock de la variante desde stocksPorSede
        let varianteStock = 0;
        let varianteStocksPorSede: any[] | undefined = undefined;

        if (v.stocksPorSede && v.stocksPorSede.length > 0) {
          // Calcular total sumando todas las sedes
          varianteStock = v.stocksPorSede.reduce(
            (sum: number, stock: any) => sum + stock.stockActual,
            0,
          );

          // Preparar desglose por sede
          varianteStocksPorSede = v.stocksPorSede.map((stock: any) => ({
            sedeId: stock.sede.id,
            sedeNombre: stock.sede.nombre,
            sedeCodigo: stock.sede.codigo,
            cantidad: stock.stockActual,
            stockMinimo: stock.stockMinimo,
            stockMaximo: stock.stockMaximo,
            ubicacion: stock.ubicacion,
            // Incluir precios de ProductoStock
            precio: stock.precio ? Number(stock.precio) : null,
            precioCosto: stock.precioCosto ? Number(stock.precioCosto) : null,
            precioOferta: stock.precioOferta ? Number(stock.precioOferta) : null,
            enOferta: stock.enOferta ?? false,
            fechaInicioOferta: stock.fechaInicioOferta,
            fechaFinOferta: stock.fechaFinOferta,
            enLiquidacion: stock.enLiquidacion ?? false,
            precioLiquidacion: stock.precioLiquidacion ? Number(stock.precioLiquidacion) : null,
            fechaInicioLiquidacion: stock.fechaInicioLiquidacion,
            fechaFinLiquidacion: stock.fechaFinLiquidacion,
            precioConfigurado: stock.precioConfigurado ?? false,
            precioIncluyeIgv: stock.precioIncluyeIgv ?? false,
          }));
        }

        // Obtener precio del primer stock con precio configurado
        let variantePrecio = 0;
        if (varianteStocksPorSede && varianteStocksPorSede.length > 0) {
          const stockConPrecio = varianteStocksPorSede.find((s: any) => s.precioConfigurado && s.precio != null);
          if (stockConPrecio) {
            variantePrecio = stockConPrecio.precio;
          }
        }

        return {
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
          precio: variantePrecio,
          stock: varianteStock, // Stock calculado desde stocksPorSede
          stocksPorSede: varianteStocksPorSede, // Desglose por sede
          isActive: v.isActive,
          orden: v.orden,
          archivos: v.archivos?.map((a: any) => ({
            id: a.id,
            url: a.url,
            urlThumbnail: a.urlThumbnail,
            orden: a.orden,
          })) || [],
        };
      }),
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
  async buildWhereClause(empresaId: string, filters: QueryProductoDto): Promise<Prisma.ProductoWhereInput> {
    const where: Prisma.ProductoWhereInput = {
      empresaId,
      // Por defecto solo no-eliminados. Si soloEliminados=true mostramos
      // SOLO los soft-deleted (papelera). Si false/undefined, los normales.
      deletedAt: filters.soloEliminados ? { not: null } : null,
    };

    // Filtro opcional por isActive (disponible para venta). Si no se pasa,
    // incluye ambos. El DTO declara isActive como string ("true"/"false")
    // por el bug de NestJS enableImplicitConversion (Boolean('false') = true);
    // acá lo interpretamos como boolean.
    if (filters.isActive === 'true') {
      where.isActive = true;
    } else if (filters.isActive === 'false') {
      where.isActive = false;
    }

    // Búsqueda por texto — optimizada:
    // 1. Códigos exactos (barcode, sku, codigoEmpresa): búsqueda exacta case-insensitive (usa índice)
    // 2. Nombre/descripción: ILIKE con texto (substring search)
    if (filters.search) {
      const search = filters.search.trim();

      // Si parece un código (sin espacios, menos de 50 chars), priorizar búsqueda exacta
      const esCodigoExacto = !search.includes(' ') && search.length < 50;

      if (esCodigoExacto) {
        where.OR = [
          { codigoBarras: { equals: search, mode: 'insensitive' } },
          { sku: { equals: search, mode: 'insensitive' } },
          { codigoEmpresa: { equals: search, mode: 'insensitive' } },
          { nombre: { contains: search, mode: 'insensitive' } },
          // Buscar también en variantes por código de barras
          { variantes: { some: { codigoBarras: { equals: search, mode: 'insensitive' } } } },
          { variantes: { some: { sku: { equals: search, mode: 'insensitive' } } } },
        ];
      } else {
        where.OR = [
          { nombre: { contains: search, mode: 'insensitive' } },
          { descripcion: { contains: search, mode: 'insensitive' } },
          { codigoEmpresa: { contains: search, mode: 'insensitive' } },
        ];
      }
    }

    // Filtros específicos
    if (filters.empresaCategoriaId) {
      where.empresaCategoriaId = filters.empresaCategoriaId;
    }

    if (filters.empresaMarcaId) {
      where.empresaMarcaId = filters.empresaMarcaId;
    }

    // ✅ NUEVO: Filtrar productos que tienen stock en la sede especificada
    // Solo mostrar productos que tienen ProductoStock creado en esa sede
    // Incluye productos con stock directo Y productos cuyas variantes tienen stock
    // Si mostrarTodos=true, se salta este filtro y se muestran todos los productos
    if (filters.sedeId && !filters.mostrarTodos) {
      const productosConStockEnSede = await this.prisma.$queryRaw<Array<{ productoId: string }>>`
        SELECT DISTINCT ps."productoId"
        FROM "ProductoStock" ps
        WHERE ps."empresaId" = ${empresaId}
        AND ps."sedeId" = ${filters.sedeId}
        AND ps."productoId" IS NOT NULL
        UNION
        SELECT DISTINCT pv."productoId"
        FROM "ProductoStock" ps
        INNER JOIN "ProductoVariante" pv ON ps."varianteId" = pv.id
        WHERE ps."empresaId" = ${empresaId}
        AND ps."sedeId" = ${filters.sedeId}
        AND ps."varianteId" IS NOT NULL
      `;

      // Agregar filtro por IDs
      if (productosConStockEnSede.length > 0) {
        where.id = {
          in: productosConStockEnSede.map(p => p.productoId),
        };
      } else {
        // Si no hay productos con stock en esta sede, forzar resultado vacío
        where.id = 'none';
      }
    }

    if (filters.visibleMarketplace !== undefined) {
      where.visibleMarketplace = filters.visibleMarketplace;
    }

    // Filtro insumos: string para evitar bug de enableImplicitConversion.
    // El frontend pasa 'true'/'false' explícito; aquí lo traducimos.
    if (filters.esInsumo === 'true') {
      where.esInsumo = true;
    } else if (filters.esInsumo === 'false') {
      where.esInsumo = false;
    }

    // Filtro de stock bajo: productos con stock <= stockMinimo en al menos una sede
    // Nota: Se implementa usando una subquery SQL cruda porque Prisma no soporta
    // comparaciones directas entre campos del mismo registro
    if (filters.stockBajo === true) {
      // Obtener IDs de productos con stock bajo usando SQL crudo
      const productosConStockBajo = await this.prisma.$queryRaw<Array<{ productoId: string }>>`
        SELECT DISTINCT ps."productoId"
        FROM "ProductoStock" ps
        WHERE ps."empresaId" = ${empresaId}
        AND ps."stockMinimo" IS NOT NULL
        AND ps."stockActual" <= ps."stockMinimo"
        AND ps."productoId" IS NOT NULL
      `;

      // Agregar filtro por IDs
      if (productosConStockBajo.length > 0) {
        where.id = {
          in: productosConStockBajo.map(p => p.productoId),
        };
      } else {
        // Si no hay productos con stock bajo, forzar resultado vacío
        where.id = 'none';
      }
    }

    // Filtrar productos con liquidacion activa en al menos una sede
    // (o en la sede especificada por filters.sedeId).
    if (filters.enLiquidacion === true) {
      const now = new Date();
      where.stocksPorSede = {
        some: {
          enLiquidacion: true,
          ...(filters.sedeId ? { sedeId: filters.sedeId } : {}),
          OR: [
            { fechaFinLiquidacion: null },
            { fechaFinLiquidacion: { gte: now } },
          ],
          AND: [
            {
              OR: [
                { fechaInicioLiquidacion: null },
                { fechaInicioLiquidacion: { lte: now } },
              ],
            },
          ],
        },
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
    includeStock: boolean = false,
    _sedeIdFilter?: string, // Deprecado: stocksPorSede siempre trae todas las sedes
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
      unidadCompra: {
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

      // Incluir stock por sede de cada variante (necesario para calcular stock total)
      // Siempre traer TODAS las sedes para mostrar información completa
      // Incluir archivos (imágenes) de cada variante
      varianteInclude.archivos = {
        where: {
          isActive: true,
          deletedAt: null,
        },
        orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
        select: {
          id: true,
          url: true,
          urlThumbnail: true,
          orden: true,
        },
      };

      if (includeStock) {
        varianteInclude.stocksPorSede = {
          select: {
            stockActual: true,
            stockReservado: true,
            stockReservadoVenta: true,
            stockReservadoCombo: true,
            stockReservadoCotizacion: true,
            stockDanado: true,
            stockEnGarantia: true,
            stockMinimo: true,
            stockMaximo: true,
            ubicacion: true,
            // Incluir precios de ProductoStock
            precio: true,
            precioCosto: true,
            precioOferta: true,
            enOferta: true,
            fechaInicioOferta: true,
            fechaFinOferta: true,
            enLiquidacion: true,
            precioLiquidacion: true,
            fechaInicioLiquidacion: true,
            fechaFinLiquidacion: true,
            precioConfigurado: true,
            precioIncluyeIgv: true,
            sede: {
              select: {
                id: true,
                nombre: true,
                codigo: true,
              },
            },
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

    // Incluir stock por sedes para calcular stock total
    // Siempre traer TODAS las sedes para mostrar información completa
    if (includeStock) {
      include.stocksPorSede = {
        select: {
          stockActual: true,
          stockReservado: true,
          stockReservadoVenta: true,
          stockReservadoCombo: true,
          stockReservadoCotizacion: true,
          stockDanado: true,
          stockEnGarantia: true,
          stockMinimo: true,
          stockMaximo: true,
          ubicacion: true,
          // Incluir precios de ProductoStock
          precio: true,
          precioCosto: true,
          precioOferta: true,
          enOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          enLiquidacion: true,
          precioLiquidacion: true,
          fechaInicioLiquidacion: true,
          fechaFinLiquidacion: true,
          precioConfigurado: true,
          precioIncluyeIgv: true,
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
            },
          },
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
