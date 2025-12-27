import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { QueryProductoDto } from './dto/query-producto.dto';
import {
  ProductoResponseDto,
  PaginatedProductoResponseDto,
} from './dto/producto-response.dto';
import { AppLoggerService } from 'src/common/logger';
import { createPaginatedResponse } from '../common/utils/pagination.util';
// Servicios especializados (Modular Monolith)
import { ProductoCatalogService } from './producto-catalog.service';
import { ProductoInventoryService } from './producto-inventory.service';
import { ProductoPricingService } from './producto-pricing.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';

/**
 * ProductoService - FACADE (Orquestador)
 *
 * Este servicio actúa como orquestador que delega operaciones a servicios especializados.
 * Responsabilidades:
 * - Orquestar llamadas a servicios especializados
 * - Verificar permisos
 * - Coordinar transacciones complejas
 * - Invalidar cache
 * - Mantener interfaz pública para ProductoController (compatibilidad)
 */
@Injectable()
export class ProductoService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private catalogService: ProductoCatalogService,
    private inventoryService: ProductoInventoryService,
    private pricingService: ProductoPricingService,
    private variantService: ProductoVarianteService,
    private atributoService: ProductoAtributoService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoService.name);
  }

  /**
   * Crear un nuevo producto
   * Método delegador (Facade) - orquesta llamadas a servicios especializados
   */
  async create(
    createDto: CreateProductoDto,
    userId: string,
  ): Promise<ProductoResponseDto> {
    const { empresaId, imagenesIds, ...productoData } = createDto;

    // 1. Verificar permisos del usuario (mantener en Facade)
    await this.verifyUserPermissions(userId, empresaId);

    // 2. Validaciones (delegar a CatalogService)
    if (productoData.empresaCategoriaId) {
      await this.catalogService.validateEmpresaCategoria(
        productoData.empresaCategoriaId,
        empresaId,
      );
    }

    if (productoData.empresaMarcaId) {
      await this.catalogService.validateEmpresaMarca(
        productoData.empresaMarcaId,
        empresaId,
      );
    }

    // 3. Validar relación XOR entre esCombo y tieneVariantes (lógica de negocio - mantener en Facade)
    if (productoData.esCombo === true && productoData.tieneVariantes === true) {
      throw new BadRequestException(
        'Un producto no puede ser combo y tener variantes al mismo tiempo. ' +
        'Deshabilite "tiene variantes" si desea crear un combo.',
      );
    }

    // Si es combo, asegurar que tieneVariantes sea false
    if (productoData.esCombo === true) {
      productoData.tieneVariantes = false;
    }

    // Si no es combo, limpiar tipoPrecioCombo (no aplica)
    if (productoData.esCombo === false && productoData.tipoPrecioCombo !== undefined) {
      productoData.tipoPrecioCombo = null;
    }

    // Establecer valor por defecto para esCombo si no se proporciona
    if (productoData.esCombo === undefined) {
      productoData.esCombo = false;
    }

    // 4. Validar atributosEstructurados (lógica de negocio - mantener en Facade)
    if (productoData.atributosEstructurados && productoData.atributosEstructurados.length > 0) {
      // Solo permitir atributos en productos sin variantes y sin combo
      if (productoData.tieneVariantes === true) {
        throw new BadRequestException(
          'No se pueden asignar atributos a un producto con variantes habilitadas. ' +
          'Los atributos deben definirse a nivel de variante.',
        );
      }
      if (productoData.esCombo === true) {
        throw new BadRequestException(
          'No se pueden asignar atributos a un producto combo.',
        );
      }
    }

    // Determinar el precio final
    // Si es combo con precio calculado y no se proporciona precio, establecer 0
    // El precio se calculará automáticamente cuando se agreguen los componentes del combo
    let precioFinal = productoData.precio ?? 0;
    if (
      productoData.esCombo === true &&
      (productoData.tipoPrecioCombo === 'CALCULADO' ||
        productoData.tipoPrecioCombo === 'CALCULADO_CON_DESCUENTO') &&
      (productoData.precio === undefined || productoData.precio === null)
    ) {
      precioFinal = 0;
    }

    try {
      // 5-9. Transacción atómica (coordinar servicios especializados)
      const producto = await this.prisma.$transaction(async (tx) => {
        // 5. Generar códigos únicos (delegar a CatalogService, pasar tx)
        const { codigoEmpresa, codigoSistema } = await this.catalogService.generateCodigos(
          empresaId,
          createDto.sedeId,
          tx,
        );

        // 6. Preparar datos para crear producto
        const dataToCreate = {
          ...productoData,
          empresaId,
          codigoEmpresa,
          codigoSistema,
          precio: precioFinal,
          stock: productoData.stock ?? 0,
          visibleMarketplace: productoData.visibleMarketplace ?? true,
          destacado: productoData.destacado ?? false,
          enOferta: productoData.enOferta ?? false,
          ...(productoData.fechaInicioOferta && {
            fechaInicioOferta: new Date(productoData.fechaInicioOferta),
          }),
          ...(productoData.fechaFinOferta && {
            fechaFinOferta: new Date(productoData.fechaFinOferta),
          }),
        };

        // 7. Crear producto usando include clause del CatalogService
        const productoCreado = await tx.producto.create({
          data: dataToCreate,
          include: this.catalogService.buildIncludeClause(true, true, false),
        });

        // 8. Sincronizar niveles de precio (delegar a PricingService, pasar tx)
        if (productoData.configuracionPrecioId) {
          await this.pricingService.sincronizarNivelesDesdeConfiguracion(
            productoCreado.id,
            productoData.configuracionPrecioId,
            empresaId,
            tx,
          );
        }

        // 9. Crear atributos (delegar a AtributoService, pasar tx)
        if (productoData.atributosEstructurados && productoData.atributosEstructurados.length > 0) {
          await this.atributoService.createProductoAtributosFromStructured(
            productoCreado.id,
            empresaId,
            productoData.atributosEstructurados,
            tx,
          );
        }

        // 10. Asociar imágenes (delegar a CatalogService, pasar tx)
        if (imagenesIds && imagenesIds.length > 0) {
          await this.catalogService.asociarImagenes(
            productoCreado.id,
            empresaId,
            imagenesIds,
            tx,
          );
        }

        return productoCreado;
      });

      this.logger.log(
        `Producto creado: ${producto.id} (${producto.codigoEmpresa})`,
      );

      // 11. Invalidar cache de estadísticas de la empresa (mantener en Facade)
      await this.invalidateEmpresaStats(empresaId);

      // 12. Obtener producto completo con archivos para respuesta (delegar a CatalogService)
      const archivos = await this.catalogService.getProductoArchivos(producto.id, empresaId);

      // 13. Convertir a DTO (delegar a CatalogService)
      return this.catalogService.toResponseDto(producto, archivos);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al crear producto: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Obtener productos con filtros y paginación
   * Método delegador (Facade) - orquesta llamadas a servicios especializados
   */
  /**
   * Obtener productos con filtros y paginación
   * Método delegador (Facade) - OPTIMIZADO para rendimiento
   *
   * Optimizaciones:
   * - Cache con Redis (TTL: 5 minutos, invalidación automática)
   * - Query única para archivos (evita N+1)
   * - Query única para stock de combos (evita N+1)
   * - Procesamiento en paralelo
   */
  async findAll(
    empresaId: string,
    queryDto: QueryProductoDto,
  ): Promise<PaginatedProductoResponseDto> {
    // OPTIMIZACIÓN: Usar cache de Redis
    const cacheKey = this.cache.getProductosListKey(empresaId, queryDto);

    // TTL: 30 minutos (usa defaultTTL del CacheService)
    return await this.cache.getOrSet(
      cacheKey,
      async () => {
        // Si no está en cache, ejecutar la query completa
        return await this._findAllFromDatabase(empresaId, queryDto);
      },
    );
  }

  /**
   * Método privado para obtener productos desde la base de datos
   * Separado para poder usar cache de forma limpia
   */
  private async _findAllFromDatabase(
    empresaId: string,
    queryDto: QueryProductoDto,
  ): Promise<PaginatedProductoResponseDto> {
    const { page = 1, limit = 10 } = queryDto;
    const skip = (page - 1) * limit;

    // 1. Construir filtros dinámicos (delegar a CatalogService)
    const where = this.catalogService.buildWhereClause(empresaId, queryDto);

    // 2. Obtener ordenamiento (delegar a CatalogService)
    const orderBy = this.catalogService.getOrderBy(queryDto.orden);

    // 3. Ejecutar consultas en paralelo (usar include clause del CatalogService)
    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.catalogService.buildIncludeClause(true, true, false),
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Si no hay productos, retornar vacío inmediatamente
    if (productos.length === 0) {
      return createPaginatedResponse([], total, page, limit);
    }

    // 4. OPTIMIZACIÓN: Obtener todos los archivos de una vez (1 query en lugar de N queries)
    const productosIds = productos.map(p => p.id);
    const todosLosArchivos = await this.prisma.archivo.findMany({
      where: {
        empresaId,
        entidadTipo: 'PRODUCTO',
        entidadId: { in: productosIds },
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      select: {
        id: true,
        url: true,
        urlThumbnail: true,
        categoria: true,
        orden: true,
        entidadId: true, // Necesario para agrupar
      },
    });

    // Agrupar archivos por productoId para acceso O(1)
    const archivosPorProducto = new Map<string, any[]>();
    for (const archivo of todosLosArchivos) {
      if (!archivosPorProducto.has(archivo.entidadId!)) {
        archivosPorProducto.set(archivo.entidadId!, []);
      }
      archivosPorProducto.get(archivo.entidadId!)!.push(archivo);
    }

    // 5. OPTIMIZACIÓN: Obtener stock de todos los combos de una vez
    const combosIds = productos.filter(p => p.esCombo).map(p => p.id);
    const stockCombosMap = new Map<string, number>();

    if (combosIds.length > 0) {
      // Obtener stock de todos los combos en paralelo
      const stockCombosPromises = combosIds.map(async (comboId) => {
        const stock = await this.inventoryService.getStockCombo(comboId);
        return { comboId, stock };
      });

      const stockCombos = await Promise.all(stockCombosPromises);
      stockCombos.forEach(({ comboId, stock }) => {
        stockCombosMap.set(comboId, stock);
      });
    }

    // 6. Convertir a DTOs (procesamiento en memoria - muy rápido)
    const productosConImagenes = productos.map((producto) => {
      // Obtener archivos del mapa (O(1) lookup)
      const archivos = archivosPorProducto.get(producto.id) || [];

      // Convertir a DTO (delegar a CatalogService)
      const productoDto = this.catalogService.toResponseDto(producto, archivos);

      // Si es un combo, usar el stock pre-calculado del mapa
      if (producto.esCombo && stockCombosMap.has(producto.id)) {
        productoDto.stock = stockCombosMap.get(producto.id)!;
      }

      return productoDto;
    });

    this.logger.debug(`📦 Productos cargados desde BD para empresa ${empresaId}`);
    return createPaginatedResponse(productosConImagenes, total, page, limit);
  }

  /**
   * Obtener un producto por ID
   * Método delegador (Facade) - orquesta llamadas a servicios especializados
   */
  async findOne(
    id: string,
    empresaId: string,
  ): Promise<ProductoResponseDto> {
    // 1. Buscar producto usando include clause del CatalogService
    const producto = await this.prisma.producto.findFirst({
      where: {
        id,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: this.catalogService.buildIncludeClause(true, true, false),
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // 2. Obtener archivos/imágenes (delegar a CatalogService)
    const archivos = await this.catalogService.getProductoArchivos(id, empresaId);

    // 3. Convertir a DTO (delegar a CatalogService)
    return this.catalogService.toResponseDto(producto, archivos);
  }

  /**
   * Actualizar un producto existente
   * Método delegador (Facade) - orquesta llamadas a servicios especializados
   */
  async update(
    id: string,
    empresaId: string,
    updateDto: UpdateProductoDto,
    userId: string,
  ): Promise<ProductoResponseDto> {
    // 1. Verificar permisos (mantener en Facade)
    await this.verifyUserPermissions(userId, empresaId);

    // 2. Verificar que el producto existe
    const productoExistente = await this.prisma.producto.findFirst({
      where: { id, empresaId, isActive: true, deletedAt: null },
    });

    if (!productoExistente) {
      throw new NotFoundException('Producto no encontrado');
    }

    const { imagenesIds, ...productoData } = updateDto;

    // 3. Validaciones (delegar a CatalogService)
    if (productoData.empresaCategoriaId) {
      await this.catalogService.validateEmpresaCategoria(
        productoData.empresaCategoriaId,
        empresaId,
      );
    }

    if (productoData.empresaMarcaId) {
      await this.catalogService.validateEmpresaMarca(
        productoData.empresaMarcaId,
        empresaId,
      );
    }

    // Validar relación XOR entre esCombo y tieneVariantes
    // Caso 1: Si se intenta activar variantes en un combo existente
    if (productoData.tieneVariantes === true && productoExistente.esCombo) {
      throw new BadRequestException(
        'No se puede activar variantes en un producto que es combo. ' +
        'Un producto no puede ser combo y tener variantes al mismo tiempo.',
      );
    }

    // Caso 2: Si se intenta marcar como combo mientras tiene variantes activas
    if (productoData.esCombo === true && productoExistente.tieneVariantes === true) {
      throw new BadRequestException(
        'No se puede marcar como combo un producto que tiene variantes activas. ' +
        'Deshabilite las variantes primero.',
      );
    }

    // Caso 3: Si se intenta marcar como combo y también habilitar variantes simultáneamente
    if (productoData.esCombo === true && productoData.tieneVariantes === true) {
      throw new BadRequestException(
        'Un producto no puede ser combo y tener variantes al mismo tiempo. ' +
        'Deshabilite "tiene variantes" si desea crear un combo.',
      );
    }

    // Si es combo, asegurar que tieneVariantes sea false (incluso si no se envía)
    if (productoData.esCombo === true) {
      productoData.tieneVariantes = false;
    }

    // Si no es combo, limpiar tipoPrecioCombo (no aplica)
    if (productoData.esCombo === false && productoData.tipoPrecioCombo !== undefined) {
      productoData.tipoPrecioCombo = null;
    }

    // Validar si se está deshabilitando variantes
    if (
      productoData.tieneVariantes === false &&
      productoExistente.tieneVariantes === true
    ) {
      const variantesActivas = await this.prisma.productoVariante.count({
        where: {
          productoId: id,
          isActive: true,
          deletedAt: null,
        },
      });

      if (variantesActivas > 0) {
        throw new BadRequestException(
          `No se puede deshabilitar variantes. El producto tiene ${variantesActivas} variante(s) activa(s). Elimínelas primero.`,
        );
      }
    }

    // 4. Si se está habilitando variantes, crear variante por defecto (delegar a VariantService)
    let variantePorDefectoCreada = false;
    if (
      productoData.tieneVariantes === true &&
      productoExistente.tieneVariantes === false
    ) {
      // Verificar que no tenga variantes ya creadas (edge case)
      const variantesExistentes = await this.prisma.productoVariante.count({
        where: {
          productoId: id,
          deletedAt: null,
        },
      });

      if (variantesExistentes === 0) {
        this.logger.info('Convirtiendo producto a variantes, creando variante por defecto', {
          productoId: id,
          stockActual: productoExistente.stock,
          precioActual: productoExistente.precio,
        });

        // Usar transacción para garantizar atomicidad en la conversión a variantes
        await this.prisma.$transaction(async (tx) => {
          // Crear variante por defecto con datos del producto (delegar a VariantService)
          const { varianteId } = await this.variantService.createVariantePorDefecto(
            id,
            empresaId,
            {
              precio: productoExistente.precio,
              precioCosto: productoExistente.precioCosto,
              stock: productoExistente.stock,
              stockMinimo: productoExistente.stockMinimo,
              peso: productoExistente.peso,
              dimensiones: productoExistente.dimensiones,
              codigoEmpresa: productoExistente.codigoEmpresa,
            },
            // Pasar función para generar código (evita dependencia circular)
            (empresaId, tx) => this.catalogService.generateCodigoVariante(empresaId, false, tx),
            tx,
          );

          // Migrar atributos del producto base a la variante (delegar a VariantService)
          await this.variantService.migrarAtributosProductoAVariante(
            id,
            varianteId,
            empresaId,
            tx,
          );

          // Migrar niveles de precio del producto base a la variante (delegar a PricingService)
          await this.pricingService.migrarNivelesProductoAVariante(
            id,
            varianteId,
            tx,
          );
        });

        // Limpiar stock base del producto para evitar confusión en BD
        // (El stock ahora se maneja a nivel de variantes)
        productoData.stock = 0;

        variantePorDefectoCreada = true;
        this.logger.success('Variante por defecto creada exitosamente', {
          stockTransferido: productoExistente.stock,
        });
      }
    }

    // Determinar el precio final para el update
    // Si es combo con precio calculado y no se proporciona precio, establecer 0
    // El precio se calculará automáticamente cuando se agreguen los componentes del combo
    const esComboActual = productoData.esCombo !== undefined ? productoData.esCombo : productoExistente.esCombo;
    const tipoPrecioComboActual = productoData.tipoPrecioCombo !== undefined
      ? productoData.tipoPrecioCombo
      : productoExistente.tipoPrecioCombo;

    // Determinar si necesitamos establecer el precio en 0
    let precioParaUpdate = productoData.precio;
    if (
      esComboActual === true &&
      (tipoPrecioComboActual === 'CALCULADO' ||
        tipoPrecioComboActual === 'CALCULADO_CON_DESCUENTO')
    ) {
      // Si se está cambiando a combo calculado o se está actualizando el tipoPrecioCombo
      if (productoData.tipoPrecioCombo !== undefined || productoData.esCombo === true) {
        precioParaUpdate = productoData.precio ?? 0;
      }
    }

    // Convertir fechas de string a Date si están presentes
    const dataToUpdate = {
      ...productoData,
      ...(precioParaUpdate !== undefined && { precio: precioParaUpdate }),
      ...(productoData.fechaInicioOferta && {
        fechaInicioOferta: new Date(productoData.fechaInicioOferta),
      }),
      ...(productoData.fechaFinOferta && {
        fechaFinOferta: new Date(productoData.fechaFinOferta),
      }),
    };

    try {
      // 5. Actualizar producto usando include clause del CatalogService
      const producto = await this.prisma.producto.update({
        where: { id },
        data: dataToUpdate,
        include: this.catalogService.buildIncludeClause(true, true, false),
      });

      // Si se desactivó el producto (era activo y ahora es inactivo) y tiene variantes,
      // desactivar todas las variantes automáticamente
      if (
        productoExistente.isActive === true &&
        producto.isActive === false &&
        productoExistente.tieneVariantes
      ) {
        const variantesActivas = await this.prisma.productoVariante.count({
          where: {
            productoId: id,
            isActive: true,
            deletedAt: null,
          },
        });

        if (variantesActivas > 0) {
          await this.prisma.productoVariante.updateMany({
            where: {
              productoId: id,
              isActive: true,
              deletedAt: null,
            },
            data: {
              isActive: false,
            },
          });

          this.logger.warn(
            `Producto ${id} desactivado. Se desactivaron automáticamente ${variantesActivas} variante(s).`,
          );
        }
      }

      // 6. Sincronizar niveles de precio (delegar a PricingService)
      // IMPORTANTE: Solo para productos SIN variantes (los que tienen variantes, los niveles van a las variantes)
      if (
        productoData.configuracionPrecioId !== undefined &&
        !producto.tieneVariantes
      ) {
        if (productoData.configuracionPrecioId) {
          // Se asignó o cambió configuración → sincronizar niveles
          await this.pricingService.sincronizarNivelesDesdeConfiguracion(
            id,
            productoData.configuracionPrecioId,
            empresaId,
          );
        } else {
          // Se removió configuración → eliminar niveles
          await this.pricingService.eliminarNivelesDeProducto(id);
        }
      }

      // 7. Actualizar imágenes (delegar a CatalogService)
      if (imagenesIds !== undefined) {
        await this.catalogService.actualizarImagenes(id, empresaId, imagenesIds);
      }

      this.logger.log(`Producto actualizado: ${id}`);

      // 8. Invalidar cache de estadísticas de la empresa (mantener en Facade)
      await this.invalidateEmpresaStats(empresaId);

      // 9. Obtener archivos actualizados para respuesta (delegar a CatalogService)
      const archivos = await this.catalogService.getProductoArchivos(id, empresaId);

      // 10. Convertir a DTO (delegar a CatalogService)
      return this.catalogService.toResponseDto(producto, archivos);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al actualizar producto: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Eliminar un producto (soft delete)
   */
  async remove(
    id: string,
    empresaId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    // Verificar permisos
    await this.verifyUserPermissions(userId, empresaId);

    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId, isActive: true, deletedAt: null },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Soft delete
    await this.prisma.producto.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    this.logger.log(`Producto eliminado: ${id}`);

    // Invalidar cache de estadísticas de la empresa
    await this.invalidateEmpresaStats(empresaId);

    return { success: true };
  }

  /**
   * Actualizar stock de un producto
   * Método delegador (Facade) - delega a InventoryService
   */
  async updateStock(
    id: string,
    empresaId: string,
    cantidad: number,
    operacion: 'agregar' | 'quitar',
  ): Promise<ProductoResponseDto> {
    // Delegar actualización de stock a InventoryService
    const productoActualizado = await this.inventoryService.updateStock(
      id,
      empresaId,
      cantidad,
      operacion,
    );

    // Obtener archivos y convertir a DTO (delegar a CatalogService)
    const archivos = await this.catalogService.getProductoArchivos(id, empresaId);
    return this.catalogService.toResponseDto(productoActualizado, archivos);
  }

  // Métodos auxiliares privados

  private async verifyUserPermissions(userId: string, empresaId: string) {
    const hasAccess = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: userId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!hasAccess) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    // Verificar permiso específico (simplificado - puede mejorarse)
    const allowedRoles = ['SUPER_ADMIN', 'EMPRESA_ADMIN', 'VENDEDOR'];
    if (!allowedRoles.includes(hasAccess.rol)) {
      throw new ForbiddenException('No tienes permisos para gestionar productos');
    }
  }

  /**
   * Obtener stock total de un producto
   * Método delegador (Facade) - delega a InventoryService
   */
  async getStockTotal(productoId: string, empresaId: string): Promise<number> {
    return await this.inventoryService.getStockTotal(productoId, empresaId);
  }

  // =========================================
  // MÉTODOS AUXILIARES PARA COMBOS
  // =========================================

  /**
   * Convierte un producto existente en combo
   * Marca el producto como combo y configura el tipo de precio
   */
  async convertirACombo(
    productoId: string,
    empresaId: string,
    tipoPrecioCombo: 'FIJO' | 'CALCULADO' | 'CALCULADO_CON_DESCUENTO',
    descuentoPorcentaje?: number,
  ): Promise<ProductoResponseDto> {
    try {
      const producto = await this.prisma.producto.findFirst({
        where: {
          id: productoId,
          empresaId,
          deletedAt: null,
        },
      });

      if (!producto) {
        throw new NotFoundException('Producto no encontrado');
      }

      if (producto.esCombo) {
        throw new BadRequestException('El producto ya es un combo');
      }

      // Validar que el producto no tenga variantes
      if (producto.tieneVariantes) {
        throw new BadRequestException(
          'No se puede convertir a combo un producto que tiene variantes habilitadas. ' +
          'Deshabilite las variantes primero.',
        );
      }

      // Actualizar producto para marcarlo como combo
      const actualizado = await this.prisma.producto.update({
        where: { id: productoId },
        data: {
          esCombo: true,
          tipoPrecioCombo,
          ...(tipoPrecioCombo === 'CALCULADO_CON_DESCUENTO' && descuentoPorcentaje
            ? { descuentoMaximo: descuentoPorcentaje }
            : {}),
        },
        include: this.catalogService.buildIncludeClause(false, false, false),
      });

      this.logger.log(`Producto ${productoId} convertido a combo tipo ${tipoPrecioCombo}`);

      // Invalidar cache
      await this.invalidateEmpresaStats(empresaId);

      return this.catalogService.toResponseDto(actualizado, []);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al convertir producto a combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Valida si un producto puede ser usado como componente de combo
   * Verifica que no sea un combo y que tenga stock disponible
   */
  async validarProductoParaCombo(productoId: string, empresaId: string): Promise<boolean> {
    try {
      const producto = await this.prisma.producto.findFirst({
        where: {
          id: productoId,
          empresaId,
          deletedAt: null,
          isActive: true,
        },
      });

      if (!producto) {
        return false;
      }

      // No permitir que combos sean componentes de otros combos
      if (producto.esCombo) {
        return false;
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al validar producto para combo: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Obtiene productos disponibles para usar como componentes de combo
   * Excluye combos y productos sin stock
   * Soporta paginación y búsqueda
   * OPTIMIZADO: Query única para archivos (evita N+1)
   */
  async getProductosDisponiblesParaCombo(
    empresaId: string,
    page: number = 1,
    limit: number = 50,
    search?: string,
  ): Promise<PaginatedProductoResponseDto> {
    try {
      const skip = (page - 1) * limit;

      const where: any = {
        empresaId,
        deletedAt: null,
        isActive: true,
        esCombo: false, // Solo productos no-combo
      };

      // Agregar búsqueda si se proporciona
      if (search) {
        where.OR = [
          { nombre: { contains: search, mode: 'insensitive' } },
          { descripcion: { contains: search, mode: 'insensitive' } },
          { codigoEmpresa: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { codigoBarras: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [productos, total] = await Promise.all([
        this.prisma.producto.findMany({
          where,
          skip,
          take: limit,
          include: this.catalogService.buildIncludeClause(true, false, false),
          orderBy: {
            nombre: 'asc',
          },
        }),
        this.prisma.producto.count({ where }),
      ]);

      // Si no hay productos, retornar vacío inmediatamente
      if (productos.length === 0) {
        return createPaginatedResponse([], total, page, limit);
      }

      // OPTIMIZACIÓN: Obtener todos los archivos de una vez (1 query en lugar de N queries)
      const productosIds = productos.map(p => p.id);
      const todosLosArchivos = await this.prisma.archivo.findMany({
        where: {
          empresaId,
          entidadTipo: 'PRODUCTO',
          entidadId: { in: productosIds },
          isActive: true,
          deletedAt: null,
        },
        orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
        select: {
          id: true,
          url: true,
          urlThumbnail: true,
          categoria: true,
          orden: true,
          entidadId: true,
        },
      });

      // Agrupar archivos por productoId para acceso O(1)
      const archivosPorProducto = new Map<string, any[]>();
      for (const archivo of todosLosArchivos) {
        if (!archivosPorProducto.has(archivo.entidadId!)) {
          archivosPorProducto.set(archivo.entidadId!, []);
        }
        archivosPorProducto.get(archivo.entidadId!)!.push(archivo);
      }

      // Convertir a DTOs con archivos (procesamiento en memoria - muy rápido)
      const data = productos.map((p) => {
        const archivos = archivosPorProducto.get(p.id) || [];
        return this.catalogService.toResponseDto(p, archivos);
      });

      return createPaginatedResponse(data, total, page, limit);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener productos para combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Invalidar cache de estadísticas y listas de productos de la empresa
   * Se llama automáticamente cuando se crea, actualiza o elimina un producto
   */
  private async invalidateEmpresaStats(empresaId: string): Promise<void> {
    try {
      // Invalidar estadísticas de la empresa
      const statsKey = this.cache.getEmpresaStatsKey(empresaId);
      await this.cache.invalidate(statsKey);

      // Invalidar TODAS las listas de productos de la empresa
      // Esto invalida todos los caches con diferentes filtros/búsquedas
      await this.cache.invalidateProductosLists(empresaId);

      this.logger.debug(`✅ Cache invalidado para empresa ${empresaId}: stats + listas de productos`);
    } catch (error) {
      // No lanzar error si falla la invalidación del cache
      // El sistema debe seguir funcionando aunque Redis falle
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️ Error al invalidar cache: ${errorMessage}`);
    }
  }
}
