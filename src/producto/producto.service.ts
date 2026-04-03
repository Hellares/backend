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
import { SedeContextHelper } from '../common/helpers/sede-context.helper';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
// Servicios especializados (Modular Monolith)
import { ProductoCatalogService } from './producto-catalog.service';
import { ProductoInventoryService } from './producto-inventory.service';
import { ProductoPricingService } from './producto-pricing.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoComboService } from './producto-combo.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';

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
    private comboService: ProductoComboService,
    private sedeContextHelper: SedeContextHelper,
    private configCodigosService: ConfiguracionCodigosService,
    private planLimitsService: PlanLimitsService,
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
    const { empresaId, imagenesIds, sedesIds, atributosEstructurados, ...productoData } = createDto as any;

    // 1. Verificar permisos del usuario (mantener en Facade)
    await this.verifyUserPermissions(userId, empresaId);

    // 1.5 Verificar límite de productos del plan de suscripción
    await this.planLimitsService.checkProductosLimit(empresaId);

    // 2. Resolver sedes: múltiples o única
    let sedesResueltas: string[] = [];

    if (sedesIds && sedesIds.length > 0) {
      // Validar todas las sedes en una sola query
      const sedesValidas = await this.prisma.sede.findMany({
        where: {
          id: { in: sedesIds },
          empresaId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, nombre: true },
      });

      // Verificar que todas las sedes proporcionadas existen
      const sedesValidasIds = new Set(sedesValidas.map(s => s.id));
      for (const sedeId of sedesIds) {
        if (!sedesValidasIds.has(sedeId)) {
          throw new BadRequestException(
            `La sede con ID ${sedeId} no existe o no está activa.`,
          );
        }
      }

      // Validar acceso del usuario a todas las sedes (una sola llamada)
      const sedesUsuario = await this.sedeContextHelper.getSedesUsuario(
        empresaId,
        userId,
      );
      const sedesUsuarioIds = new Set(sedesUsuario.map(s => s.id));

      for (const sede of sedesValidas) {
        if (!sedesUsuarioIds.has(sede.id)) {
          throw new ForbiddenException(
            `No tienes acceso a la sede ${sede.nombre}.`,
          );
        }
      }

      sedesResueltas = sedesIds;
    } else {
      // Resolver sede automáticamente usando la lógica existente
      const sedeIdResuelto = await this.sedeContextHelper.resolveSedeId(
        empresaId,
        userId,
        undefined,
      );
      sedesResueltas = [sedeIdResuelto];
    }

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

    // 4. Validar relación XOR entre esCombo y tieneVariantes (lógica de negocio - mantener en Facade)
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

    // 5. Validar atributosEstructurados (lógica de negocio - mantener en Facade)
    if (atributosEstructurados && atributosEstructurados.length > 0) {
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

    try {
      // 6-11. Transacción atómica para crear productos en múltiples sedes
      const productosCreados = await this.prisma.$transaction(async (tx) => {
        const productos = [];

        for (const sedeId of sedesResueltas) {
          // 6. Generar códigos únicos para esta sede
          const { codigoEmpresa, codigoSistema } = await this.configCodigosService.generarCodigoProducto(
            empresaId,
            sedeId,
            tx,
          );

          // 7. Preparar datos para crear producto
          const dataToCreate = {
            ...productoData,
            empresaId,
            sedeId,
            codigoEmpresa,
            codigoSistema,
            visibleMarketplace: productoData.visibleMarketplace ?? true,
            destacado: productoData.destacado ?? false,
          };

          // 8. Crear producto usando include clause del CatalogService
          const productoCreado = await tx.producto.create({
            data: dataToCreate,
            include: this.catalogService.buildIncludeClause(true, true, false, true),
          });

          // 9. Sincronizar niveles de precio (delegar a PricingService, pasar tx)
          if (productoData.configuracionPrecioId) {
            await this.pricingService.sincronizarNivelesDesdeConfiguracion(
              productoCreado.id,
              productoData.configuracionPrecioId,
              empresaId,
              tx,
            );
          }

          // 10. Crear atributos (delegar a AtributoService, pasar tx)
          if (atributosEstructurados && atributosEstructurados.length > 0) {
            await this.atributoService.createProductoAtributosFromStructured(
              productoCreado.id,
              empresaId,
              atributosEstructurados,
              tx,
            );
          }

          // 11. Asociar imágenes (delegar a CatalogService, pasar tx)
          if (imagenesIds && imagenesIds.length > 0) {
            await this.catalogService.asociarImagenes(
              productoCreado.id,
              empresaId,
              imagenesIds,
              tx,
            );
          }

          // 12. Crear registro inicial en ProductoStock para esta sede
          // Esto permite que el producto aparezca en los listados filtrados por sede
          // aunque aún no tenga precio/stock configurado
          await tx.productoStock.create({
            data: {
              empresaId,
              sedeId,
              productoId: productoCreado.id,
              varianteId: null,
              stockActual: 0,
              stockMinimo: null,
              stockMaximo: null,
              ubicacion: null,
              precio: null,
              precioCosto: null,
              precioOferta: null,
              enOferta: false,
              fechaInicioOferta: null,
              fechaFinOferta: null,
              precioConfigurado: false,
            },
          });

          productos.push(productoCreado);
        }

        return productos;
      });

      // Log de productos creados
      if (productosCreados.length > 1) {
        this.logger.log(
          `Productos creados en ${productosCreados.length} sedes: ${productosCreados.map(p => `${p.id} (${p.codigoEmpresa})`).join(', ')}`,
        );
      } else {
        this.logger.log(
          `Producto creado: ${productosCreados[0].id} (${productosCreados[0].codigoEmpresa})`,
        );
      }

      // Retornar el primer producto creado (para mantener compatibilidad con el tipo de retorno)
      const producto = productosCreados[0];

      // 12. Invalidar cache de estadísticas de la empresa (mantener en Facade)
      await this.invalidateEmpresaStats(empresaId);

      // 13. Obtener producto completo con archivos para respuesta (delegar a CatalogService)
      const archivos = await this.catalogService.getProductoArchivos(producto.id, empresaId);

      // 14. Convertir a DTO (delegar a CatalogService)
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
    const where = await this.catalogService.buildWhereClause(empresaId, queryDto);

    // 2. Obtener ordenamiento (delegar a CatalogService)
    const orderBy = this.catalogService.getOrderBy(queryDto.orden);

    // 3. Ejecutar consultas en paralelo (usar include clause del CatalogService)
    // Para búsquedas con texto, usamos count limitado para evitar escanear millones de filas
    const MAX_COUNT_SCAN = 10000;

    const countQuery = queryDto.search
      ? this.prisma.producto.findMany({
          where,
          select: { id: true },
          take: MAX_COUNT_SCAN,
        }).then(rows => rows.length)
      : this.prisma.producto.count({ where });

    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.catalogService.buildIncludeClause(true, true, false, true),
      }),
      countQuery,
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

    // 5. OPTIMIZACIÓN: Obtener stock, precio y reservaciones de todos los combos en bulk (3 queries en vez de 3N)
    const combosIds = productos.filter(p => p.esCombo).map(p => p.id);
    let stockCombosMap = new Map<string, number>();
    let precioCombosMap = new Map<string, number>();
    let reservacionCombosMap = new Map<string, number>();

    if (combosIds.length > 0 && queryDto.sedeId) {
      const combosBulk = await this.comboService.getCombosBulkData(combosIds, queryDto.sedeId);
      stockCombosMap = combosBulk.stocks;
      precioCombosMap = combosBulk.precios;
      reservacionCombosMap = combosBulk.reservaciones;
    }

    // 6. Convertir a DTOs (procesamiento en memoria - muy rápido)
    const productosConImagenes = productos.map((producto) => {
      // Obtener archivos del mapa (O(1) lookup)
      const archivos = archivosPorProducto.get(producto.id) || [];

      // Convertir a DTO (delegar a CatalogService)
      const productoDto = this.catalogService.toResponseDto(producto, archivos);

      // Si es un combo, usar stock reservado y precio calculado
      if (producto.esCombo) {
        const stockCombo = stockCombosMap.get(producto.id) ?? 0;
        const precioCombo = precioCombosMap.get(producto.id);
        const reservaCombo = reservacionCombosMap.get(producto.id) ?? 0;

        productoDto.stock = stockCombo;
        productoDto.comboReservado = reservaCombo;

        if (precioCombo != null) {
          productoDto.precio = precioCombo;
        }

        // Actualizar stocksPorSede para que la UI lo lea correctamente
        if (productoDto.stocksPorSede && queryDto.sedeId) {
          const stockSede = productoDto.stocksPorSede.find((s: any) => s.sedeId === queryDto.sedeId);
          if (stockSede) {
            stockSede.cantidad = stockCombo;
            if (precioCombo != null) {
              stockSede.precio = precioCombo;
              stockSede.precioConfigurado = true;
            }
          }
        }
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
      include: this.catalogService.buildIncludeClause(true, true, false, true),
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

    // DEBUG: Log para verificar qué datos llegan
    // this.logger.debug('Datos recibidos para actualización', {
    //   productoId: id,
    //   enOferta: productoData.enOferta,
    //   precioOferta: productoData.precioOferta,
    //   fechaInicioOferta: productoData.fechaInicioOferta,
    //   fechaFinOferta: productoData.fechaFinOferta,
    // });

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

    // Caso 4: No permitir habilitar variantes si el producto es componente de algún combo
    if (
      productoData.tieneVariantes === true &&
      productoExistente.tieneVariantes === false
    ) {
      const usadoEnCombos = await this.prisma.productoCombo.findFirst({
        where: { componenteProductoId: id },
        include: {
          combo: { select: { nombre: true } },
        },
      });

      if (usadoEnCombos) {
        throw new BadRequestException(
          `No se puede habilitar variantes. Este producto es componente del combo "${usadoEnCombos.combo.nombre}". ` +
          'Elimínelo de todos los combos antes de convertirlo a variantes.',
        );
      }
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
          // Los precios ahora se gestionan en ProductoStock por sede
          // Stock ahora se maneja en ProductoStock por sede
        });

        // Usar transacción para garantizar atomicidad en la conversión a variantes
        await this.prisma.$transaction(async (tx) => {
          // Crear variante por defecto con datos del producto (delegar a VariantService)
          // NOTA: El stock y precios se migran separadamente usando migrarProductoStockAVariante()
          const { varianteId } = await this.variantService.createVariantePorDefecto(
            id,
            empresaId,
            {
              nombre: productoExistente.nombre,
              // Los precios ya no se pasan aquí, se mantienen en ProductoStock
              peso: productoExistente.peso,
              dimensiones: productoExistente.dimensiones,
              codigoEmpresa: productoExistente.codigoEmpresa,
            },
            // Pasar función para generar código (usando servicio centralizado)
            (empresaId, tx) => this.configCodigosService.generarCodigoVariante(empresaId, tx),
            tx,
          );

          // Migrar atributos del producto base a la variante (delegar a VariantService)
          await this.variantService.migrarAtributosProductoAVariante(
            id,
            varianteId,
            empresaId,
            tx,
          );

          // Migrar registros de ProductoStock del producto base a la variante
          // Esto preserva el stock de todas las sedes y genera movimientos de auditoría
          await this.variantService.migrarProductoStockAVariante(
            id,
            varianteId,
            empresaId,
            userId,
            tx,
          );

          // Migrar niveles de precio del producto base a la variante (delegar a PricingService)
          await this.pricingService.migrarNivelesProductoAVariante(
            id,
            varianteId,
            tx,
          );

          // Migrar archivos/imágenes del producto base a la variante
          // Obtener los archivos que necesitan migración
          const archivosAMigrar = await tx.archivo.findMany({
            where: {
              entidadTipo: 'PRODUCTO',
              entidadId: id,
              empresaId,
              deletedAt: null,
            },
            select: { id: true },
          });

          // Migrar todos los archivos en una sola operación
          if (archivosAMigrar.length > 0) {
            await tx.archivo.updateMany({
              where: {
                id: { in: archivosAMigrar.map(a => a.id) },
              },
              data: {
                entidadTipo: 'PRODUCTO_VARIANTE',
                entidadId: varianteId,
                varianteId: varianteId,
              },
            });

            this.logger.debug(`${archivosAMigrar.length} archivos migrados del producto ${id} a la variante ${varianteId}`);
          }
        });

        // El stock del producto base ya fue migrado a ProductoStock de la variante
        // Los campos deprecated (stock/stockMinimo) ya no se usan en el DTO

        variantePorDefectoCreada = true;
        this.logger.success('Variante por defecto creada exitosamente. Stock migrado a ProductoStock de la variante.');
      }
    }

    // Determinar el precio final para el update
    // Si es combo con precio calculado y no se proporciona precio, establecer 0
    // El precio se calculará automáticamente cuando se agreguen los componentes del combo
    const esComboActual = productoData.esCombo !== undefined ? productoData.esCombo : productoExistente.esCombo;
    const tipoPrecioComboActual = productoData.tipoPrecioCombo !== undefined
      ? productoData.tipoPrecioCombo
      : productoExistente.tipoPrecioCombo;

    // Preparar datos para actualización
    // Extraer atributosEstructurados que no es campo Prisma (se procesa aparte en la transacción)
    const { atributosEstructurados, ...restProductoData } = productoData as any;

    const dataToUpdate: any = {
      ...restProductoData,
    };

    // Procesar videoUrl de forma especial si está presente
    if ('videoUrl' in productoData) {
      const valorVideoUrl: any = productoData.videoUrl;

      // Si es null, undefined, o string vacío, establecer como null para eliminar el video
      if (
        valorVideoUrl === null ||
        valorVideoUrl === undefined ||
        (typeof valorVideoUrl === 'string' && valorVideoUrl.trim() === '')
      ) {
        dataToUpdate.videoUrl = null;
      } else {
        // Mantener el valor si es una string válida
        dataToUpdate.videoUrl = valorVideoUrl;
      }
    }

    try {
      // 5-8. Transacción atómica para update + variantes + precios + imágenes + atributos
      const producto = await this.prisma.$transaction(async (tx) => {
        // 5. Actualizar producto
        const productoActualizado = await tx.producto.update({
          where: { id },
          data: dataToUpdate,
          include: this.catalogService.buildIncludeClause(true, true, false, true),
        });

        // Si se desactivó el producto y tiene variantes, desactivarlas
        if (
          productoExistente.isActive === true &&
          productoActualizado.isActive === false &&
          productoExistente.tieneVariantes
        ) {
          const result = await tx.productoVariante.updateMany({
            where: {
              productoId: id,
              isActive: true,
              deletedAt: null,
            },
            data: {
              isActive: false,
            },
          });

          if (result.count > 0) {
            this.logger.warn(
              `Producto ${id} desactivado. Se desactivaron automáticamente ${result.count} variante(s).`,
            );
          }
        }

        // 6. Sincronizar niveles de precio (dentro de la transacción)
        if (
          productoData.configuracionPrecioId !== undefined &&
          !productoActualizado.tieneVariantes
        ) {
          if (productoData.configuracionPrecioId) {
            await this.pricingService.sincronizarNivelesDesdeConfiguracion(
              id,
              productoData.configuracionPrecioId,
              empresaId,
              tx,
            );
          } else {
            await this.pricingService.eliminarNivelesDeProducto(id, tx);
          }
        }

        // 7. Actualizar imágenes (dentro de la transacción)
        if (imagenesIds !== undefined && !productoActualizado.tieneVariantes) {
          await this.catalogService.actualizarImagenes(id, empresaId, imagenesIds, tx);
        }

        // 8. Actualizar atributos estructurados (dentro de la transacción)
        if (atributosEstructurados && atributosEstructurados.length > 0 && !productoActualizado.tieneVariantes && !productoActualizado.esCombo) {
          // Eliminar atributos existentes del producto
          await tx.productoAtributoValor.deleteMany({
            where: { productoId: id },
          });
          // Crear los nuevos
          await this.atributoService.createProductoAtributosFromStructured(
            id,
            empresaId,
            atributosEstructurados,
            tx,
          );
        }

        return productoActualizado;
      }, { timeout: 15000 });

      this.logger.log(`Producto actualizado: ${id}`);

      // 8. Invalidar cache (fuera de transacción, no es crítico)
      await this.invalidateEmpresaStats(empresaId);

      // 9. Obtener archivos actualizados para respuesta
      const archivos = await this.catalogService.getProductoArchivos(id, empresaId);

      // 10. Convertir a DTO
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
  /**
   * Actualiza el stock de un producto
   * MIGRADO: Ahora requiere sedeId y usuarioId para usar ProductoStock
   */
  async updateStock(
    id: string,
    empresaId: string,
    sedeId: string,
    cantidad: number,
    operacion: 'agregar' | 'quitar',
    usuarioId: string,
  ): Promise<{ stock: number; stockTotal: number }> {
    // Delegar actualización de stock a InventoryService (ahora usa ProductoStock)
    return await this.inventoryService.updateStock(
      id,
      empresaId,
      sedeId,
      cantidad,
      operacion,
      usuarioId,
    );
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
        include: this.catalogService.buildIncludeClause(false, false, false, true),
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

      // Para búsquedas con texto, usamos count limitado para evitar escanear millones de filas
      const MAX_COUNT_SCAN = 10000;

      const countQuery = search
        ? this.prisma.producto.findMany({
            where,
            select: { id: true },
            take: MAX_COUNT_SCAN,
          }).then(rows => rows.length)
        : this.prisma.producto.count({ where });

      const [productos, total] = await Promise.all([
        this.prisma.producto.findMany({
          where,
          skip,
          take: limit,
          include: this.catalogService.buildIncludeClause(true, false, false, true),
          orderBy: {
            nombre: 'asc',
          },
        }),
        countQuery,
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

  /**
   * Calcular nuevo precio aplicando el ajuste y redondeo
   */
  private calcularNuevoPrecio(
    precioActual: number,
    valor: number,
    operacion: string,
    tipoRedondeo: string,
  ): number {
    let precioNuevo: number;

    // Calcular ajuste por porcentaje
    const factor = valor / 100;
    if (operacion === 'INCREMENTO') {
      precioNuevo = precioActual * (1 + factor);
    } else {
      // DECREMENTO
      precioNuevo = precioActual * (1 - factor);
    }

    // Aplicar redondeo a 2 decimales
    if (tipoRedondeo === 'DOS_DECIMALES') {
      precioNuevo = Math.round(precioNuevo * 100) / 100;
    }

    return precioNuevo;
  }

  // =========================================
  // MÉTODOS DE CÓDIGO DE BARRAS
  // =========================================

  async getProductosSinBarcode(empresaId: string, sedeId?: string) {
    const where: any = {
      empresaId,
      isActive: true,
      deletedAt: null,
      OR: [{ codigoBarras: null }, { codigoBarras: '' }],
    };

    const productos = await this.prisma.producto.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        sku: true,
        codigoBarras: true,
        stocksPorSede: {
          where: sedeId ? { sedeId } : {},
          select: {
            id: true,
            stockActual: true,
            precio: true,
            sedeId: true,
            sede: { select: { nombre: true } },
          },
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return productos.map(p => ({
      id: p.id,
      productoId: p.id,
      nombre: p.nombre,
      codigoEmpresa: p.codigoEmpresa,
      sku: p.sku,
      codigoBarras: p.codigoBarras,
      stockActual: p.stocksPorSede[0]?.stockActual ?? 0,
      precio: p.stocksPorSede[0]?.precio ? Number(p.stocksPorSede[0].precio) : null,
      sedeNombre: p.stocksPorSede[0]?.sede?.nombre ?? null,
    }));
  }

  async generarCodigosBarras(empresaId: string, productoIds: string[], formato: 'INTERNO' | 'EAN13' = 'INTERNO') {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { subdominio: true },
    });

    const prefijo = (empresa?.subdominio ?? 'SYN').toUpperCase().substring(0, 3);
    const resultados: Array<{ productoId: string; varianteId?: string; tipo: string; codigo: string; nombre: string }> = [];

    for (const productoId of productoIds) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: productoId, empresaId },
        include: { variantes: { select: { id: true, nombre: true, codigoBarras: true, sku: true } } },
      });
      if (!producto) continue;

      if (!producto.codigoBarras) {
        const codigo = formato === 'EAN13'
          ? this._generarEAN13(resultados.length + 1)
          : await this._generarCodigoInterno(empresaId, prefijo);

        await this.prisma.producto.update({
          where: { id: productoId },
          data: { codigoBarras: codigo },
        });
        resultados.push({ productoId, tipo: 'PRODUCTO', codigo, nombre: producto.nombre });
      }

      for (const variante of producto.variantes) {
        if (!variante.codigoBarras) {
          const codigo = formato === 'EAN13'
            ? this._generarEAN13(resultados.length + 1)
            : await this._generarCodigoInterno(empresaId, prefijo);

          await this.prisma.productoVariante.update({
            where: { id: variante.id },
            data: { codigoBarras: codigo },
          });
          resultados.push({ productoId, varianteId: variante.id, tipo: 'VARIANTE', codigo, nombre: `${producto.nombre} - ${variante.nombre}` });
        }
      }
    }

    return { generados: resultados.length, resultados };
  }

  private async _generarCodigoInterno(empresaId: string, prefijo: string): Promise<string> {
    const ultimo = await this.prisma.producto.findFirst({
      where: { empresaId, codigoBarras: { startsWith: prefijo } },
      orderBy: { codigoBarras: 'desc' },
      select: { codigoBarras: true },
    });

    // Also check variantes
    const ultimaVariante = await this.prisma.productoVariante.findFirst({
      where: { producto: { empresaId }, codigoBarras: { startsWith: prefijo } },
      orderBy: { codigoBarras: 'desc' },
      select: { codigoBarras: true },
    });

    let secuencial = 1;
    const codigos = [ultimo?.codigoBarras, ultimaVariante?.codigoBarras].filter(Boolean) as string[];
    for (const cod of codigos) {
      const match = cod.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1]);
        if (num >= secuencial) secuencial = num + 1;
      }
    }

    return `${prefijo}${secuencial.toString().padStart(7, '0')}`;
  }

  private _generarEAN13(seed: number): string {
    // Generate a valid EAN-13 with check digit
    const timestamp = Date.now().toString().slice(-8);
    const base = (timestamp + seed.toString().padStart(4, '0')).substring(0, 12);
    const digits = base.split('').map(Number);
    const checksum = (10 - (digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0) % 10)) % 10;
    return base + checksum;
  }
}
