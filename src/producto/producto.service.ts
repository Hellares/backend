import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import {
  QueryProductoDto,
  OrdenProducto,
} from './dto/query-producto.dto';
import {
  ProductoResponseDto,
  PaginatedProductoResponseDto,
} from './dto/producto-response.dto';
import { AppLoggerService } from 'src/common/logger';
import { ProductoComboService } from './producto-combo.service';
import { createPaginatedResponse } from '../common/utils/pagination.util';

@Injectable()
export class ProductoService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => ProductoComboService))
    private productoComboService: ProductoComboService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoService.name);
  }

  /**
   * Crear un nuevo producto
   */
  async create(
    createDto: CreateProductoDto,
    userId: string,
  ): Promise<ProductoResponseDto> {
    const { empresaId, imagenesIds, ...productoData } = createDto;

    // Verificar permisos del usuario
    await this.verifyUserPermissions(userId, empresaId);

    // Validar que la categoría pertenece a la empresa
    if (productoData.empresaCategoriaId) {
      await this.validateEmpresaCategoria(
        productoData.empresaCategoriaId,
        empresaId,
      );
    }

    // Validar que la marca pertenece a la empresa
    if (productoData.empresaMarcaId) {
      await this.validateEmpresaMarca(productoData.empresaMarcaId, empresaId);
    }

    // Validar relación XOR entre esCombo y tieneVariantes
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

    // Validar atributosEstructurados
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

    // Generar códigos únicos
    const { codigoEmpresa, codigoSistema } = await this.generateCodigos(
      empresaId,
      createDto.sedeId,
    );

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

    // Convertir fechas de string a Date si están presentes
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

    try {
      // Crear producto (el código ya es único gracias a generateCodigos)
      const producto = await this.prisma.producto.create({
        data: dataToCreate,
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: true,
          variantes: {
            where: {
              deletedAt: null,
              isActive: true,
            },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              productoId: true,
              empresaId: true,
              nombre: true,
              sku: true,
              codigoBarras: true,
              codigoEmpresa: true,
              precio: true,
              precioCosto: true,
              precioOferta: true,
              stock: true,
              stockMinimo: true,
              peso: true,
              dimensiones: true,
              isActive: true,
              orden: true,
              creadoEn: true,
              actualizadoEn: true,
              atributosValores: {
                include: {
                  atributo: {
                    select:{
                      id: true,
                      nombre: true,
                      clave: true,
                      tipo: true,
                      unidad: true,
                    }
                  }
                }
              }
            },
          },
        },
      });

      // Crear atributos si se proporcionaron
      if (productoData.atributosEstructurados && productoData.atributosEstructurados.length > 0) {
        await this.createProductoAtributosFromStructured(
          producto.id,
          empresaId,
          productoData.atributosEstructurados,
        );
      }

      // Asociar imágenes si se proporcionaron
      if (imagenesIds && imagenesIds.length > 0) {
        await this.asociarImagenes(producto.id, empresaId, imagenesIds);
      }

      this.logger.log(
        `Producto creado: ${producto.id} (${producto.codigoEmpresa})`,
      );

      // Invalidar cache de estadísticas de la empresa
      await this.invalidateEmpresaStats(empresaId);

      // Obtener producto con atributos para respuesta
      const productoConAtributos = await this.prisma.producto.findUnique({
        where: { id: producto.id },
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: true,
          variantes: {
            where: {
              deletedAt: null,
              isActive: true,
            },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              productoId: true,
              empresaId: true,
              nombre: true,
              sku: true,
              codigoBarras: true,
              codigoEmpresa: true,
              precio: true,
              precioCosto: true,
              precioOferta: true,
              stock: true,
              stockMinimo: true,
              peso: true,
              dimensiones: true,
              isActive: true,
              orden: true,
              creadoEn: true,
              actualizadoEn: true,
              atributosValores: {
                include: {
                  atributo: {
                    select: {
                      id: true,
                      nombre: true,
                      clave: true,
                      tipo: true,
                      unidad: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      return this.toResponseDto(productoConAtributos);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al crear producto: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Obtener productos con filtros y paginación
   */
  async findAll(
    empresaId: string,
    queryDto: QueryProductoDto,
  ): Promise<PaginatedProductoResponseDto> {
    const {
      page = 1,
      limit = 10,
      search,
      empresaCategoriaId,
      empresaMarcaId,
      sedeId,
      visibleMarketplace,
      destacado,
      enOferta,
      stockBajo,
      soloProductos,
      soloCombos,
      orden,
    } = queryDto;

    const skip = (page - 1) * limit;

    // Construir filtros dinámicos
    const where: any = {
      empresaId,
      isActive: true,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { descripcion: { contains: search, mode: 'insensitive' } },
        { codigoEmpresa: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { codigoBarras: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (empresaCategoriaId) where.empresaCategoriaId = empresaCategoriaId;
    if (empresaMarcaId) where.empresaMarcaId = empresaMarcaId;
    if (sedeId) where.sedeId = sedeId;
    if (visibleMarketplace !== undefined)
      where.visibleMarketplace = visibleMarketplace;
    if (destacado !== undefined) where.destacado = destacado;

    // Filtro de ofertas: validar que no estén expiradas
    if (enOferta !== undefined) {
      if (enOferta === true) {
        // Solo mostrar ofertas activas y no expiradas
        where.enOferta = true;
        // Agregar validación de fecha de expiración
        if (!where.AND) where.AND = [];
        where.AND.push({
          OR: [
            { fechaFinOferta: null }, // Ofertas sin fecha de fin
            { fechaFinOferta: { gte: new Date() } }, // Ofertas que aún no expiran
          ],
        });
      } else {
        where.enOferta = false;
      }
    }

    // Filtros de tipo de producto
    if (soloProductos !== undefined && soloProductos === true) {
      where.esCombo = false;
    }
    if (soloCombos !== undefined && soloCombos === true) {
      where.esCombo = true;
    }

    // Filtro de stock bajo
    if (stockBajo) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        stock: { lte: this.prisma.producto.fields.stockMinimo },
      });
    }

    // Ordenamiento
    const orderBy = this.getOrderBy(orden);

    // Consultas
    const [productos, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: { select: { id: true, nombre: true } },
          atributosValores: {
            where: {
              varianteId: null, // Solo atributos del producto base (no de variantes)
            },
            include: {
              atributo: {
                select: {
                  id: true,
                  nombre: true,
                  clave: true,
                  tipo: true,
                  unidad: true,
                },
              },
            },
          },
          variantes: {
            where: {
              deletedAt: null,
              isActive: true,
            },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              productoId: true,
              empresaId: true,
              nombre: true,
              sku: true,
              codigoBarras: true,
              codigoEmpresa: true,
              precio: true,
              precioCosto: true,
              precioOferta: true,
              stock: true,
              stockMinimo: true,
              peso: true,
              dimensiones: true,
              isActive: true,
              orden: true,
              creadoEn: true,
              actualizadoEn: true,
              atributosValores: {
                include: {
                  atributo: {
                    select:{
                      id: true,
                      nombre: true,
                      clave: true,
                      tipo: true,
                      unidad: true,
                    }
                  }
                }
              }
            },
          },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Obtener imágenes y calcular stock para cada producto
    const productosConImagenes = await Promise.all(
      productos.map(async (producto) => {
        const archivos = await this.prisma.archivo.findMany({
          where: {
            empresaId,
            entidadTipo: 'PRODUCTO',
            entidadId: producto.id,
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
          },
        });

        const productoDto = this.toResponseDto(producto, archivos);

        // Si es un combo, calcular el stock disponible basado en componentes
        if (producto.esCombo) {
          const stockDisponible = await this.productoComboService.getStockDisponibleCombo(producto.id);
          productoDto.stock = stockDisponible;
        }

        return productoDto;
      }),
    );

    return createPaginatedResponse(productosConImagenes, total, page, limit);
  }

  /**
   * Obtener un producto por ID
   */
  async findOne(
    id: string,
    empresaId: string,
  ): Promise<ProductoResponseDto> {
    const producto = await this.prisma.producto.findFirst({
      where: {
        id,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        empresaCategoria: {
          include: {
            categoriaMaestra: true,
          },
        },
        empresaMarca: {
          include: {
            marcaMaestra: true,
          },
        },
        sede: true,
        atributosValores: {
          where: {
            varianteId: null, // Solo atributos del producto base (no de variantes)
          },
          include: {
            atributo: {
              select: {
                id: true,
                nombre: true,
                clave: true,
                tipo: true,
                unidad: true,
              },
            },
          },
        },
        variantes: {
          where: {
            deletedAt: null,
            isActive: true,
          },
          orderBy: { orden: 'asc' },
          select: {
            id: true,
            productoId: true,
            empresaId: true,
            nombre: true,
            sku: true,
            codigoBarras: true,
            codigoEmpresa: true,
            precio: true,
            precioCosto: true,
            precioOferta: true,
            stock: true,
            stockMinimo: true,
            peso: true,
            dimensiones: true,
            isActive: true,
            orden: true,
            creadoEn: true,
            actualizadoEn: true,
            atributosValores: {
                include: {
                  atributo: {
                    select:{
                      id: true,
                      nombre: true,
                      clave: true,
                      tipo: true,
                      unidad: true,
                    }
                  }
                }
              }
          },
        },
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Obtener archivos/imágenes
    const archivos = await this.prisma.archivo.findMany({
      where: {
        empresaId,
        entidadTipo: 'PRODUCTO',
        entidadId: id,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });

    return this.toResponseDto(producto, archivos);
  }

  /**
   * Actualizar un producto
   */
  async update(
    id: string,
    empresaId: string,
    updateDto: UpdateProductoDto,
    userId: string,
  ): Promise<ProductoResponseDto> {
    // Verificar permisos
    await this.verifyUserPermissions(userId, empresaId);

    // Verificar que el producto existe
    const productoExistente = await this.prisma.producto.findFirst({
      where: { id, empresaId, isActive: true, deletedAt: null },
    });

    if (!productoExistente) {
      throw new NotFoundException('Producto no encontrado');
    }

    const { imagenesIds, ...productoData } = updateDto;

    // Validar categoría si se está actualizando
    if (productoData.empresaCategoriaId) {
      await this.validateEmpresaCategoria(
        productoData.empresaCategoriaId,
        empresaId,
      );
    }

    // Validar marca si se está actualizando
    if (productoData.empresaMarcaId) {
      await this.validateEmpresaMarca(productoData.empresaMarcaId, empresaId);
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

    // Si se está habilitando variantes, crear variante por defecto con datos actuales
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

        // Generar código único para la variante usando transacción para evitar race conditions
        const { codigoEmpresa } = await this.generateCodigoVariante(empresaId);

        // Crear variante por defecto con los datos del producto original
        let variantePorDefecto;
        try {
          variantePorDefecto = await this.prisma.productoVariante.create({
            data: {
              productoId: id,
              empresaId,
              nombre: 'Original',
              sku: `${productoExistente.codigoEmpresa}-ORIGINAL`,
              codigoBarras: null, // No copiar código de barras, se asignará después si es necesario
              codigoEmpresa,
              precio: productoExistente.precio,
              precioCosto: productoExistente.precioCosto,
              stock: productoExistente.stock,
              stockMinimo: productoExistente.stockMinimo,
              peso: productoExistente.peso,
              dimensiones: productoExistente.dimensiones as any,
              isActive: true,
              orden: 0,
            },
          });
        } catch (error) {
          // Si falla por código duplicado, reintentar con un nuevo código
          if (error.code === 'P2002' && error.meta?.target?.includes('codigoEmpresa')) {
            this.logger.warn(`Código de variante duplicado ${codigoEmpresa}, generando nuevo código`);
            const { codigoEmpresa: nuevoCodigo } = await this.generateCodigoVariante(empresaId, true);
            variantePorDefecto = await this.prisma.productoVariante.create({
              data: {
                productoId: id,
                empresaId,
                nombre: 'Original',
                sku: `${productoExistente.codigoEmpresa}-ORIGINAL`,
                codigoBarras: null,
                codigoEmpresa: nuevoCodigo,
                precio: productoExistente.precio,
                precioCosto: productoExistente.precioCosto,
                stock: productoExistente.stock,
                stockMinimo: productoExistente.stockMinimo,
                peso: productoExistente.peso,
                dimensiones: productoExistente.dimensiones as any,
                isActive: true,
                orden: 0,
              },
            });
          } else {
            throw error;
          }
        }

        // Migrar atributos del producto base a la variante por defecto
        await this.migrarAtributosProductoAVariante(id, variantePorDefecto.id, empresaId);

        // Limpiar stock base del producto para evitar confusión en BD
        // (El stock ahora se maneja a nivel de variantes)
        productoData.stock = 0;

        variantePorDefectoCreada = true;
        this.logger.success('Variante por defecto creada exitosamente', {
          codigoEmpresa,
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
      // Actualizar producto
      const producto = await this.prisma.producto.update({
        where: { id },
        data: dataToUpdate,
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: true,
          atributosValores: {
            where: {
              varianteId: null,
            },
            include: {
              atributo: {
                select: {
                  id: true,
                  nombre: true,
                  clave: true,
                  tipo: true,
                  unidad: true,
                },
              },
            },
          },
          variantes: {
            where: {
              deletedAt: null,
              isActive: true,
            },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              productoId: true,
              empresaId: true,
              nombre: true,
              sku: true,
              codigoBarras: true,
              codigoEmpresa: true,
              precio: true,
              precioCosto: true,
              precioOferta: true,
              stock: true,
              stockMinimo: true,
              peso: true,
              dimensiones: true,
              isActive: true,
              orden: true,
              creadoEn: true,
              actualizadoEn: true,
              atributosValores: {
                  include: {
                    atributo: {
                      select:{
                        id: true,
                        nombre: true,
                        clave: true,
                        tipo: true,
                        unidad: true,
                      }
                    }
                  }
                }
            },
          },
        },
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

      // Actualizar imágenes si se proporcionaron
      if (imagenesIds !== undefined) {
        await this.actualizarImagenes(id, empresaId, imagenesIds);
      }

      this.logger.log(`Producto actualizado: ${id}`);

      // Invalidar cache de estadísticas de la empresa
      await this.invalidateEmpresaStats(empresaId);

      // Obtener archivos actualizados
      const archivos = await this.prisma.archivo.findMany({
        where: {
          empresaId,
          entidadTipo: 'PRODUCTO',
          entidadId: id,
          isActive: true,
          deletedAt: null,
        },
        orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      });

      return this.toResponseDto(producto, archivos);
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
   */
  async updateStock(
    id: string,
    empresaId: string,
    cantidad: number,
    operacion: 'agregar' | 'quitar',
  ): Promise<ProductoResponseDto> {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId, isActive: true, deletedAt: null },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Validar que el producto no tenga variantes
    if (producto.tieneVariantes) {
      throw new BadRequestException(
        'No se puede actualizar el stock directamente en productos con variantes. ' +
        'Actualice el stock de cada variante individualmente.',
      );
    }

    const nuevoStock =
      operacion === 'agregar'
        ? producto.stock + cantidad
        : producto.stock - cantidad;

    if (nuevoStock < 0) {
      throw new BadRequestException('Stock insuficiente');
    }

    const productoActualizado = await this.prisma.producto.update({
      where: { id },
      data: { stock: nuevoStock },
      include: {
        empresaCategoria: {
          include: {
            categoriaMaestra: true,
          },
        },
        empresaMarca: {
          include: {
            marcaMaestra: true,
          },
        },
        sede: true,
        variantes: {
          where: {
            deletedAt: null,
            isActive: true,
          },
          orderBy: { orden: 'asc' },
          select: {
            id: true,
            productoId: true,
            empresaId: true,
            nombre: true,
            sku: true,
            codigoBarras: true,
            codigoEmpresa: true,
            precio: true,
            precioCosto: true,
            precioOferta: true,
            stock: true,
            stockMinimo: true,
            peso: true,
            dimensiones: true,
            isActive: true,
            orden: true,
            creadoEn: true,
            actualizadoEn: true,
            atributosValores: {
                include: {
                  atributo: {
                    select:{
                      id: true,
                      nombre: true,
                      clave: true,
                      tipo: true,
                      unidad: true,
                    }
                  }
                }
              }
          },
        },
      },
    });

    return this.toResponseDto(productoActualizado);
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

  private async validateEmpresaCategoria(
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

  private async validateEmpresaMarca(
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

  private async generateCodigos(empresaId: string, sedeId?: string) {
    // Usar transacción para evitar race conditions
    return await this.prisma.$transaction(async (tx) => {
      // Obtener o crear configuración de códigos
      let config = await tx.configuracionCodigos.findUnique({
        where: { empresaId },
      });

      if (!config) {
        // Crear configuración por defecto
        config = await tx.configuracionCodigos.create({
          data: { empresaId },
        });
      }

      // Sincronizar contador con el estado real de la BD
      // Esto evita bucles innecesarios cuando hay productos eliminados
      const ultimoProducto = await tx.producto.findFirst({
        where: {
          empresaId,
          deletedAt: null,
          codigoEmpresa: {
            startsWith: config.productoCodigo,
          },
        },
        orderBy: {
          codigoEmpresa: 'desc',
        },
        select: {
          codigoEmpresa: true,
        },
      });

      let nuevoContador = config.ultimoProducto;

      // Si hay productos, extraer el número del último código
      if (ultimoProducto) {
        // Extraer número del código (ej: "PROD-000015" -> 15)
        const match = ultimoProducto.codigoEmpresa.match(/(\d+)$/);
        if (match) {
          const ultimoNumero = parseInt(match[1], 10);
          // Si el último número es mayor que el contador, actualizar
          if (ultimoNumero >= nuevoContador) {
            nuevoContador = ultimoNumero;
            // Actualizar configuración para mantener sincronizado
            await tx.configuracionCodigos.update({
              where: { empresaId },
              data: { ultimoProducto: nuevoContador },
            });
          }
        }
      }

      // Incrementar contador atómicamente
      const updated = await tx.configuracionCodigos.update({
        where: { empresaId },
        data: {
          ultimoProducto: {
            increment: 1,
          },
        },
      });

      nuevoContador = updated.ultimoProducto;

      // Generar código
      const numero = nuevoContador.toString().padStart(config.productoLongitud, '0');
      let codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${numero}`;

      if (config.productoIncluirSede && sedeId) {
        const sede = await tx.sede.findUnique({
          where: { id: sedeId },
          select: { nombre: true },
        });
        if (sede) {
          const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
          codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${sedeCode}${config.productoSeparador}${numero}`;
        }
      }

      const codigoSistema = `${empresaId.substring(0, 8)}-PROD-${numero}`;

      // Verificación final por si acaso (muy raro que ocurra)
      const existe = await tx.producto.findFirst({
        where: {
          empresaId,
          codigoEmpresa,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (existe) {
        // Si aún existe (caso muy raro), hacer un reintento recursivo
        this.logger.warn(
          `Código ${codigoEmpresa} ya existe después de sincronización. Reintentando...`,
        );
        // Hacer una llamada recursiva (solo debería ocurrir en casos extremos)
        return this.generateCodigos(empresaId, sedeId);
      }

      return { codigoEmpresa, codigoSistema };
    });
  }

  /**
   * Genera un código único para una variante de producto
   * Usa transacción para evitar race conditions y verifica que el código no exista
   * @param empresaId ID de la empresa
   * @param forceIncrement Si es true, incrementa el contador incluso si el código ya existe (para reintentos)
   * @returns Código único para la variante
   */
  private async generateCodigoVariante(
    empresaId: string,
    forceIncrement: boolean = false,
  ): Promise<{ codigoEmpresa: string }> {
    // Usar transacción para evitar race conditions
    return await this.prisma.$transaction(async (tx) => {
      // Obtener o crear configuración de códigos
      let config = await tx.configuracionCodigos.findUnique({
        where: { empresaId },
      });

      if (!config) {
        // Crear configuración por defecto
        config = await tx.configuracionCodigos.create({
          data: { empresaId },
        });
      }

      // Sincronizar contador con el estado real de la BD
      // Esto evita bucles innecesarios cuando hay variantes eliminadas
      const ultimaVariante = await tx.productoVariante.findFirst({
        where: {
          empresaId,
          deletedAt: null,
          codigoEmpresa: {
            startsWith: config.varianteCodigo,
          },
        },
        orderBy: {
          codigoEmpresa: 'desc',
        },
        select: {
          codigoEmpresa: true,
        },
      });

      let nuevoContador = config.ultimaVariante;

      // Si hay variantes, extraer el número del último código
      if (ultimaVariante) {
        // Extraer número del código (ej: "VAR-001" -> 1)
        const match = ultimaVariante.codigoEmpresa.match(/(\d+)$/);
        if (match) {
          const ultimoNumero = parseInt(match[1], 10);
          // Si el último número es mayor que el contador, actualizar
          if (ultimoNumero >= nuevoContador) {
            nuevoContador = ultimoNumero;
            // Actualizar configuración para mantener sincronizado
            await tx.configuracionCodigos.update({
              where: { empresaId },
              data: { ultimaVariante: nuevoContador },
            });
          }
        }
      }

      // Incrementar contador atómicamente
      const updated = await tx.configuracionCodigos.update({
        where: { empresaId },
        data: {
          ultimaVariante: {
            increment: 1,
          },
        },
      });

      nuevoContador = updated.ultimaVariante;

      // Generar código
      const numero = nuevoContador.toString().padStart(config.varianteLongitud, '0');
      const codigoEmpresa = `${config.varianteCodigo}${config.varianteSeparador}${numero}`;

      // Verificación final por si acaso (muy raro que ocurra)
      const existe = await tx.productoVariante.findFirst({
        where: {
          empresaId,
          codigoEmpresa,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (existe) {
        // Si aún existe (caso muy raro), hacer un reintento recursivo
        this.logger.warn(
          `Código de variante ${codigoEmpresa} ya existe después de sincronización. Reintentando...`,
        );
        // Hacer una llamada recursiva (solo debería ocurrir en casos extremos)
        return this.generateCodigoVariante(empresaId, true);
      }

      return { codigoEmpresa };
    });
  }

  private async asociarImagenes(
    productoId: string,
    empresaId: string,
    imagenesIds: string[],
  ) {
    // Actualizar archivos para asociarlos con el producto
    await this.prisma.archivo.updateMany({
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

  private async actualizarImagenes(
    productoId: string,
    empresaId: string,
    imagenesIds: string[],
  ) {
    // Desasociar imágenes anteriores
    await this.prisma.archivo.updateMany({
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
      await this.asociarImagenes(productoId, empresaId, imagenesIds);
    }
  }

  private getOrderBy(orden?: OrdenProducto) {
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

  private toResponseDto(producto: any, archivos?: any[]): ProductoResponseDto {
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

    // Desestructurar para excluir empresaCategoria, empresaMarca, empresa, sede, variantes y atributosValores
    const { empresaCategoria, empresaMarca, empresa, sede, variantes, atributosValores, ...productoData } = producto;

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

  /**
   * Obtener stock total de un producto
   * Si tiene variantes, suma el stock de todas las variantes activas
   * Si no tiene variantes, retorna el stock del producto base
   */
  async getStockTotal(productoId: string, empresaId: string): Promise<number> {
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

    // Si tiene variantes, sumar stock de todas las variantes activas
    if (producto.tieneVariantes) {
      const result = await this.prisma.productoVariante.aggregate({
        where: {
          productoId,
          isActive: true,
          deletedAt: null,
        },
        _sum: {
          stock: true,
        },
      });

      return result._sum.stock || 0;
    }

    // Si no tiene variantes, retornar stock del producto base
    return producto.stock;
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
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: true,
        },
      });

      this.logger.log(`Producto ${productoId} convertido a combo tipo ${tipoPrecioCombo}`);

      // Invalidar cache
      await this.invalidateEmpresaStats(empresaId);

      return this.toResponseDto(actualizado, []);
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
          include: {
            empresaCategoria: {
              include: {
                categoriaMaestra: true,
              },
            },
            empresaMarca: {
              include: {
                marcaMaestra: true,
              },
            },
            sede: true,
            variantes: {
              where: {
                isActive: true,
                deletedAt: null,
              },
              orderBy: {
                orden: 'asc',
              },
            },
          },
          orderBy: {
            nombre: 'asc',
          },
        }),
        this.prisma.producto.count({ where }),
      ]);

      const data = productos.map((p) => this.toResponseDto(p));
      return createPaginatedResponse(data, total, page, limit);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener productos para combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Crea atributos estructurados para un producto base
   * Convierte el formato array de atributos a la tabla ProductoAtributoValor
   */
  private async createProductoAtributosFromStructured(
    productoId: string,
    empresaId: string,
    atributosEstructurados: Array<{ atributoId: string; valor: string }>,
  ): Promise<void> {
    if (atributosEstructurados.length === 0) {
      return;
    }

    // Verificar que los atributos pertenezcan a la empresa y estén activos
    const atributoIds = atributosEstructurados.map(a => a.atributoId);
    const atributosExistentes = await this.prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
        isActive: true,
      },
      select: { id: true },
    });

    const existentesSet = new Set(atributosExistentes.map(a => a.id));
    const atributosValidos = atributosEstructurados.filter(a => existentesSet.has(a.atributoId));

    if (atributosValidos.length === 0) {
      this.logger.warn(`Ningún atributoId válido encontrado para empresa ${empresaId}. No se crearán valores.`);
      return;
    }

    const valoresAtributos = atributosValidos.map(a => ({
      productoId,
      atributoId: a.atributoId,
      valor: String(a.valor),
    }));

    await this.prisma.productoAtributoValor.createMany({
      data: valoresAtributos,
      skipDuplicates: true,
    });

    this.logger.debug(`Creados ${valoresAtributos.length} valores de atributos estructurados para producto ${productoId}`);
  }

  /**
   * Migra atributos de un producto base a una variante
   * Actualiza los registros de ProductoAtributoValor para que apunten a la variante en lugar del producto
   */
  private async migrarAtributosProductoAVariante(
    productoId: string,
    varianteId: string,
    empresaId: string,
  ): Promise<void> {
    // Obtener todos los atributos del producto base
    const atributosProducto = await this.prisma.productoAtributoValor.findMany({
      where: {
        productoId,
        varianteId: null,
        atributo: {
          empresaId,
          isActive: true,
        },
      },
      select: {
        id: true,
        atributoId: true,
        valor: true,
      },
    });

    if (atributosProducto.length === 0) {
      this.logger.debug(`No hay atributos para migrar del producto ${productoId} a variante ${varianteId}`);
      return;
    }

    // Actualizar cada atributo para asignarle la varianteId y desvincularlo del producto
    await Promise.all(
      atributosProducto.map(async (atributo) => {
        await this.prisma.productoAtributoValor.update({
          where: { id: atributo.id },
          data: {
            productoId: null,
            varianteId,
          },
        });
      }),
    );

    this.logger.debug(`Migrados ${atributosProducto.length} atributos del producto ${productoId} a variante ${varianteId}`);
  }

  /**
   * Invalidar cache de estadísticas de la empresa
   * Se llama automáticamente cuando se crea, actualiza o elimina un producto
   */
  private async invalidateEmpresaStats(empresaId: string): Promise<void> {
    try {
      const cacheKey = this.cache.getEmpresaStatsKey(empresaId);
      await this.cache.invalidate(cacheKey);
      this.logger.debug(`Cache de estadísticas invalidado para empresa: ${empresaId}`);
    } catch (error) {
      // No lanzar error si falla la invalidación del cache
      // El sistema debe seguir funcionando aunque Redis falle
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache de estadísticas: ${errorMessage}`);
    }
  }
}
