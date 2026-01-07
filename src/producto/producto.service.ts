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
import {
  AjusteMasivoPreciosDto,
  AjusteMasivoPreciosResponseDto,
} from './dto/ajuste-masivo-precios.dto';
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
import { ProductoPrecioHistorialService } from './producto-precio-historial.service';

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
    private precioHistorialService: ProductoPrecioHistorialService,
    private sedeContextHelper: SedeContextHelper,
    private configCodigosService: ConfiguracionCodigosService,
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
    const { empresaId, imagenesIds, sedeId, ...productoData } = createDto;

    // 1. Verificar permisos del usuario (mantener en Facade)
    await this.verifyUserPermissions(userId, empresaId);

    // 2. Resolver sedeId automáticamente o validar el proporcionado
    const sedeIdResuelto = await this.sedeContextHelper.resolveSedeId(
      empresaId,
      userId,
      sedeId,
    );

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
      // 6-11. Transacción atómica (coordinar servicios especializados)
      const producto = await this.prisma.$transaction(async (tx) => {
        // 6. Generar códigos únicos (usando servicio centralizado)
        const { codigoEmpresa, codigoSistema } = await this.configCodigosService.generarCodigoProducto(
          empresaId,
          sedeIdResuelto,
          tx,
        );

        // 7. Preparar datos para crear producto
        const dataToCreate = {
          ...productoData,
          empresaId,
          sedeId: sedeIdResuelto,
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

        // 8. Crear producto usando include clause del CatalogService
        const productoCreado = await tx.producto.create({
          data: dataToCreate,
          include: this.catalogService.buildIncludeClause(true, true, false),
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
        if (productoData.atributosEstructurados && productoData.atributosEstructurados.length > 0) {
          await this.atributoService.createProductoAtributosFromStructured(
            productoCreado.id,
            empresaId,
            productoData.atributosEstructurados,
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

        return productoCreado;
      });

      this.logger.log(
        `Producto creado: ${producto.id} (${producto.codigoEmpresa})`,
      );

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

    // DEBUG: Log para verificar qué datos llegan
    this.logger.debug('Datos recibidos para actualización', {
      productoId: id,
      enOferta: productoData.enOferta,
      precioOferta: productoData.precioOferta,
      fechaInicioOferta: productoData.fechaInicioOferta,
      fechaFinOferta: productoData.fechaFinOferta,
    });

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

          // Actualizar cada archivo individualmente para asegurar que todos los campos se actualicen
          if (archivosAMigrar.length > 0) {
            this.logger.debug(`Iniciando migración de ${archivosAMigrar.length} archivos...`);

            for (const archivo of archivosAMigrar) {
              this.logger.debug(`Actualizando archivo ${archivo.id}: entidadTipo -> PRODUCTO_VARIANTE, entidadId -> ${varianteId}`);

              await tx.archivo.update({
                where: { id: archivo.id },
                data: {
                  entidadTipo: 'PRODUCTO_VARIANTE',
                  entidadId: varianteId,
                  varianteId: varianteId,
                },
              });

              // Verificar que se actualizó correctamente
              const verificacion = await tx.archivo.findUnique({
                where: { id: archivo.id },
                select: { entidadTipo: true, entidadId: true, varianteId: true },
              });

              this.logger.debug(`Archivo ${archivo.id} actualizado. Verificación: entidadTipo=${verificacion?.entidadTipo}, entidadId=${verificacion?.entidadId}, varianteId=${verificacion?.varianteId}`);
            }

            this.logger.debug(`${archivosAMigrar.length} archivos migrados del producto ${id} a la variante ${varianteId}`);
          }
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
    // Convertir campos numéricos a tipos adecuados para Prisma Decimal
    const dataToUpdate: any = {
      ...productoData,
      ...(precioParaUpdate !== undefined && { precio: precioParaUpdate }),
      ...(productoData.fechaInicioOferta && {
        fechaInicioOferta: new Date(productoData.fechaInicioOferta),
      }),
      ...(productoData.fechaFinOferta && {
        fechaFinOferta: new Date(productoData.fechaFinOferta),
      }),
    };

    // Procesar precioOferta de forma especial si está presente
    if ('precioOferta' in productoData) {
      const valorPrecioOferta: any = productoData.precioOferta;

      // Si es null, undefined, string vacío, o un valor inválido, establecer como null
      if (
        valorPrecioOferta === null ||
        valorPrecioOferta === undefined ||
        valorPrecioOferta === '' ||
        (typeof valorPrecioOferta === 'number' && isNaN(valorPrecioOferta))
      ) {
        dataToUpdate.precioOferta = null;
      } else {
        // Asegurar que sea un número válido
        const precioNumero = Number(valorPrecioOferta);
        dataToUpdate.precioOferta = isNaN(precioNumero) ? null : precioNumero;
      }
    }

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
      // 5. Actualizar producto usando include clause del CatalogService
      const producto = await this.prisma.producto.update({
        where: { id },
        data: dataToUpdate,
        include: this.catalogService.buildIncludeClause(true, true, false),
      });

      // 5.1 Registrar cambios de precio en el historial (si aplica)
      await this.registrarCambiosPrecio(
        productoExistente,
        producto,
        userId,
      );

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
      // IMPORTANTE: Solo actualizar imágenes si el producto NO tiene variantes
      // Si tiene variantes, las imágenes están asociadas a las variantes, no al producto base
      if (imagenesIds !== undefined && !producto.tieneVariantes) {
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
   * Ajuste masivo de precios
   * Permite incrementar o decrementar precios por porcentaje de forma masiva
   */
  async ajusteMasivoPrecios(
    empresaId: string,
    usuarioId: string,
    dto: AjusteMasivoPreciosDto,
  ): Promise<AjusteMasivoPreciosResponseDto> {
    // 1. Verificar permisos
    await this.verifyUserPermissions(usuarioId, empresaId);

    // 2. Obtener productos según el alcance
    let productos: any[];

    if (dto.alcance === 'TODOS') {
      // Obtener todos los productos activos de la empresa
      productos = await this.prisma.producto.findMany({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
        include: {
          variantes: dto.incluirVariantes
            ? {
                where: {
                  isActive: true,
                  deletedAt: null,
                },
              }
            : false,
        },
      });
    } else {
      // SELECCIONADOS: obtener productos por IDs
      productos = await this.prisma.producto.findMany({
        where: {
          id: { in: dto.productosIds },
          empresaId,
          isActive: true,
          deletedAt: null,
        },
        include: {
          variantes: dto.incluirVariantes
            ? {
                where: {
                  isActive: true,
                  deletedAt: null,
                },
              }
            : false,
        },
      });
    }

    if (productos.length === 0) {
      throw new BadRequestException('No se encontraron productos para ajustar');
    }

    // 3. Calcular nuevos precios
    const cambios: any[] = [];
    const advertencias: string[] = [];
    let totalProductosAfectados = 0;
    let totalVariantesAfectadas = 0;

    for (const producto of productos) {
      // Calcular nuevo precio del producto
      const precioAnterior = producto.precio.toNumber();
      const precioNuevo = this.calcularNuevoPrecio(
        precioAnterior,
        dto.valor,
        dto.operacion,
        dto.redondeo,
      );

      // Validar que el precio no sea negativo
      if (precioNuevo <= 0) {
        advertencias.push(
          `El producto "${producto.nombre}" quedaría con precio negativo o cero. Se omite.`,
        );
        continue;
      }

      // Agregar cambio del producto
      cambios.push({
        productoId: producto.id,
        nombre: producto.nombre,
        precioAnterior,
        precioNuevo,
        diferencia: precioNuevo - precioAnterior,
        diferenciaPercentual: ((precioNuevo - precioAnterior) / precioAnterior) * 100,
      });

      totalProductosAfectados++;

      // Si incluye variantes, procesarlas
      if (dto.incluirVariantes && producto.variantes && producto.variantes.length > 0) {
        for (const variante of producto.variantes) {
          const variantePrecioAnterior = variante.precio.toNumber();
          const variantePrecioNuevo = this.calcularNuevoPrecio(
            variantePrecioAnterior,
            dto.valor,
            dto.operacion,
            dto.redondeo,
          );

          if (variantePrecioNuevo <= 0) {
            advertencias.push(
              `La variante "${variante.nombre}" del producto "${producto.nombre}" quedaría con precio negativo. Se omite.`,
            );
            continue;
          }

          cambios.push({
            productoId: producto.id,
            nombre: producto.nombre,
            varianteId: variante.id,
            varianteNombre: variante.nombre,
            precioAnterior: variantePrecioAnterior,
            precioNuevo: variantePrecioNuevo,
            diferencia: variantePrecioNuevo - variantePrecioAnterior,
            diferenciaPercentual:
              ((variantePrecioNuevo - variantePrecioAnterior) / variantePrecioAnterior) * 100,
          });

          totalVariantesAfectadas++;
        }
      }
    }

    // 4. Si es preview, solo retornar los cambios calculados
    if (dto.preview) {
      return {
        resumen: {
          totalProductosAfectados,
          totalVariantesAfectadas,
          ajustePromedio: dto.valor,
          operacion: dto.operacion,
          valorAjuste: dto.valor,
        },
        cambios,
        advertencias: advertencias.length > 0 ? advertencias : undefined,
        esPreview: true,
      };
    }

    // 5. Si NO es preview, aplicar los cambios
    const razonAjuste = dto.razon || `Ajuste masivo: ${dto.operacion === 'INCREMENTO' ? '+' : '-'}${dto.valor}%`;

    for (const cambio of cambios) {
      if (cambio.varianteId) {
        // Actualizar variante
        const varianteAntes = await this.prisma.productoVariante.findUnique({
          where: { id: cambio.varianteId },
        });

        await this.prisma.productoVariante.update({
          where: { id: cambio.varianteId },
          data: { precio: cambio.precioNuevo },
        });

        // Registrar en historial
        if (varianteAntes) {
          await this.precioHistorialService.registrarCambio({
            productoId: cambio.productoId,
            varianteId: cambio.varianteId,
            precioAnterior: cambio.precioAnterior,
            precioNuevo: cambio.precioNuevo,
            tipoCambio: 'AJUSTE_MASIVO',
            razon: razonAjuste,
            origenModulo: 'PRODUCTO',
            usuarioId,
          });
        }
      } else {
        // Actualizar producto
        const productoAntes = await this.prisma.producto.findUnique({
          where: { id: cambio.productoId },
        });

        await this.prisma.producto.update({
          where: { id: cambio.productoId },
          data: { precio: cambio.precioNuevo },
        });

        // Registrar en historial
        if (productoAntes) {
          await this.precioHistorialService.registrarCambio({
            productoId: cambio.productoId,
            precioAnterior: cambio.precioAnterior,
            precioNuevo: cambio.precioNuevo,
            tipoCambio: 'AJUSTE_MASIVO',
            razon: razonAjuste,
            origenModulo: 'PRODUCTO',
            usuarioId,
          });
        }
      }
    }

    // 6. Invalidar cache
    await this.invalidateEmpresaStats(empresaId);

    // 7. Log de la operación
    this.logger.info('Ajuste masivo de precios aplicado', {
      empresaId,
      usuarioId,
      totalProductos: totalProductosAfectados,
      totalVariantes: totalVariantesAfectadas,
      operacion: dto.operacion,
      valor: dto.valor,
    });

    // 8. Retornar resultado
    return {
      resumen: {
        totalProductosAfectados,
        totalVariantesAfectadas,
        ajustePromedio: dto.valor,
        operacion: dto.operacion,
        valorAjuste: dto.valor,
      },
      cambios,
      advertencias: advertencias.length > 0 ? advertencias : undefined,
      esPreview: false,
    };
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
   * Registrar cambios de precio en el historial
   * Detecta y registra cambios en: precio base, precio de oferta, precio de costo
   */
  private async registrarCambiosPrecio(
    productoAntes: any,
    productoDespues: any,
    usuarioId: string,
  ): Promise<void> {
    try {
      // 1. Detectar cambio en precio base
      const precioAnterior = productoAntes.precio?.toNumber();
      const precioNuevo = productoDespues.precio?.toNumber();

      if (precioAnterior !== undefined && precioNuevo !== undefined && precioAnterior !== precioNuevo) {
        await this.precioHistorialService.registrarCambio({
          productoId: productoDespues.id,
          precioAnterior,
          precioNuevo,
          tipoCambio: 'MANUAL',
          razon: 'Actualización manual del precio base',
          origenModulo: 'PRODUCTO',
          usuarioId,
        });
      }

      // 2. Detectar cambio en precio de costo
      const precioCostoAnterior = productoAntes.precioCosto?.toNumber();
      const precioCostoNuevo = productoDespues.precioCosto?.toNumber();

      if (
        precioCostoAnterior !== undefined &&
        precioCostoNuevo !== undefined &&
        precioCostoAnterior !== precioCostoNuevo
      ) {
        await this.precioHistorialService.registrarCambio({
          productoId: productoDespues.id,
          precioNuevo: precioNuevo || precioAnterior || 0,
          precioCostoAnterior,
          precioCostoNuevo,
          tipoCambio: 'COSTO_ACTUALIZADO',
          razon: 'Actualización del precio de costo',
          origenModulo: 'PRODUCTO',
          usuarioId,
        });
      }

      // 3. Detectar activación de oferta
      const ofertaActivada =
        productoAntes.enOferta === false &&
        productoDespues.enOferta === true &&
        productoDespues.precioOferta !== null;

      if (ofertaActivada) {
        const precioOfertaNuevo = productoDespues.precioOferta?.toNumber();

        await this.precioHistorialService.registrarCambio({
          productoId: productoDespues.id,
          precioAnterior: precioNuevo || precioAnterior || 0,
          precioNuevo: precioOfertaNuevo || 0,
          tipoCambio: 'OFERTA_ACTIVADA',
          razon: `Oferta activada: ${productoDespues.fechaInicioOferta ? 'desde ' + productoDespues.fechaInicioOferta.toISOString().split('T')[0] : ''} ${productoDespues.fechaFinOferta ? 'hasta ' + productoDespues.fechaFinOferta.toISOString().split('T')[0] : ''}`.trim(),
          origenModulo: 'PRODUCTO',
          usuarioId,
        });
      }

      // 4. Detectar desactivación de oferta
      const ofertaDesactivada =
        productoAntes.enOferta === true &&
        productoDespues.enOferta === false;

      if (ofertaDesactivada) {
        const precioOfertaAnterior = productoAntes.precioOferta?.toNumber();

        await this.precioHistorialService.registrarCambio({
          productoId: productoDespues.id,
          precioAnterior: precioOfertaAnterior || 0,
          precioNuevo: precioNuevo || precioAnterior || 0,
          tipoCambio: 'OFERTA_DESACTIVADA',
          razon: 'Oferta desactivada - retorno a precio normal',
          origenModulo: 'PRODUCTO',
          usuarioId,
        });
      }

      // 5. Detectar cambio en precio de oferta (mientras la oferta está activa)
      if (
        productoAntes.enOferta === true &&
        productoDespues.enOferta === true
      ) {
        const precioOfertaAnterior = productoAntes.precioOferta?.toNumber();
        const precioOfertaNuevo = productoDespues.precioOferta?.toNumber();

        if (
          precioOfertaAnterior !== undefined &&
          precioOfertaNuevo !== undefined &&
          precioOfertaAnterior !== precioOfertaNuevo
        ) {
          await this.precioHistorialService.registrarCambio({
            productoId: productoDespues.id,
            precioAnterior: precioOfertaAnterior,
            precioNuevo: precioOfertaNuevo,
            tipoCambio: 'MANUAL',
            razon: 'Actualización del precio de oferta',
            origenModulo: 'PRODUCTO',
            usuarioId,
          });
        }
      }
    } catch (error) {
      // No lanzar error si falla el registro del historial
      // El sistema debe seguir funcionando aunque falle el historial
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error al registrar cambios de precio en historial para producto ${productoDespues.id}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
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
}
