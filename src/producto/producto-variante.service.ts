import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { ProductoVarianteResponseDto } from './dto/producto-variante-response.dto';
import { GenerateVarianteCombinationsDto } from './dto/generate-variante-combinations.dto';

@Injectable()
export class ProductoVarianteService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly configCodigosService: ConfiguracionCodigosService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoVarianteService.name);
  }

  /**
   * Crear una variante para un producto
   */
  async create(
    productoId: string,
    empresaId: string,
    dto: CreateProductoVarianteDto,
  ): Promise<ProductoVarianteResponseDto> {
    this.logger.info('Creating product variant', { productoId, empresaId, dto });

    // Verificar que el producto existe y tiene variantes habilitadas
    const producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    if (!producto.tieneVariantes) {
      throw new BadRequestException('El producto no tiene variantes habilitadas');
    }

    // Validar que el producto padre esté activo si se intenta crear una variante activa
    if ((dto.isActive === undefined || dto.isActive === true) && !producto.isActive) {
      throw new BadRequestException(
        'No se puede crear una variante activa cuando el producto padre está inactivo. ' +
        'Active primero el producto padre o cree la variante como inactiva.',
      );
    }

    // Verificar que el SKU no existe
    const existingSku = await this.prisma.productoVariante.findFirst({
      where: {
        empresaId,
        sku: dto.sku,
        deletedAt: null,
      },
    });

    if (existingSku) {
      throw new ConflictException(`Ya existe una variante con el SKU: ${dto.sku}`);
    }

    // Generar código de empresa único (usando servicio centralizado)
    const { codigoEmpresa } = await this.configCodigosService.generarCodigoVariante(empresaId);

    // Crear la variante (SIN campos de stock legacy - usar ProductoStock)
    const variante = await this.prisma.productoVariante.create({
      data: {
        productoId,
        empresaId,
        nombre: dto.nombre,
        sku: dto.sku,
        codigoBarras: dto.codigoBarras,
        codigoEmpresa,
        peso: dto.peso,
        dimensiones: dto.dimensiones,
        isActive: dto.isActive ?? true,
        orden: dto.orden ?? 0,
      },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
    });

    // Crear atributos estructurados si se proporcionaron
    if (dto.atributosEstructurados && dto.atributosEstructurados.length > 0) {
      await this.createVarianteAtributosFromStructured(variante.id, empresaId, dto.atributosEstructurados);

      // Recargar variante con atributos creados
      const varianteConAtributos = await this.prisma.productoVariante.findUnique({
        where: { id: variante.id },
        include: {
          archivos: {
            where: { deletedAt: null },
            orderBy: { orden: 'asc' },
          },
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
          stocksPorSede: {
            select: {
              stockActual: true,
              sede: {
                select: {
                  id: true,
                  nombre: true,
                  codigo: true,
                },
              },
            },
          },
        },
      });
      
      if (varianteConAtributos) {
        Object.assign(variante, varianteConAtributos);
      }
    }

    // Asociar imágenes si se proporcionaron
    if (dto.imagenesIds && dto.imagenesIds.length > 0) {
      await this.prisma.archivo.updateMany({
        where: {
          id: { in: dto.imagenesIds },
          empresaId,
        },
        data: {
          varianteId: variante.id,
          entidadTipo: 'PRODUCTO_VARIANTE',
          entidadId: variante.id,
        },
      });
    }

    // Copiar niveles de precio de otra variante del mismo producto
    await this.copiarNivelesDeOtraVariante(productoId, variante.id);

    // Crear ProductoStock en las sedes correspondientes
    await this.crearProductoStockEnSedes(variante.id, productoId, empresaId);

    // Recargar variante con stocksPorSede recién creados
    const varianteFinal = await this.recargarVariante(variante.id);

    // Invalidar cache de productos (las variantes afectan el stock total)
    await this.cache.invalidateProductosLists(empresaId);

    this.logger.success('Product variant created', { varianteId: variante.id });

    return this.mapToResponseDto(varianteFinal);
  }

  /**
   * Obtener todas las variantes de un producto
   */
  async findByProducto(
    productoId: string,
    empresaId: string,
    includeInactive = false,
  ): Promise<ProductoVarianteResponseDto[]> {
    this.logger.debug('Finding variants by product', { productoId, empresaId });

    const variantes = await this.prisma.productoVariante.findMany({
      where: {
        productoId,
        empresaId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
      orderBy: { orden: 'asc' },
    });

    return variantes.map((v) => this.mapToResponseDto(v));
  }

  /**
   * Obtener una variante por ID
   */
  async findOne(
    varianteId: string,
    empresaId: string,
  ): Promise<ProductoVarianteResponseDto> {
    this.logger.debug('Finding variant by ID', { varianteId, empresaId });

    const variante = await this.prisma.productoVariante.findFirst({
      where: {
        id: varianteId,
        empresaId,
        deletedAt: null,
      },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    return this.mapToResponseDto(variante);
  }

  /**
   * Actualizar una variante
   */
  async update(
    varianteId: string,
    empresaId: string,
    dto: UpdateProductoVarianteDto,
  ): Promise<ProductoVarianteResponseDto> {
    this.logger.info('Updating variant', { varianteId, empresaId, dto });

    // Verificar que la variante existe
    const existing = await this.prisma.productoVariante.findFirst({
      where: {
        id: varianteId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    // Validar que el producto padre esté activo si se intenta activar la variante
    if (dto.isActive === true) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: existing.productoId },
        select: { isActive: true },
      });

      if (producto && !producto.isActive) {
        throw new BadRequestException(
          'No se puede activar una variante cuando el producto padre está inactivo. ' +
          'Active primero el producto padre.',
        );
      }
    }

    // Si se actualiza el SKU, verificar que no exista
    if (dto.sku && dto.sku !== existing.sku) {
      const existingSku = await this.prisma.productoVariante.findFirst({
        where: {
          empresaId,
          sku: dto.sku,
          id: { not: varianteId },
          deletedAt: null,
        },
      });

      if (existingSku) {
        throw new ConflictException(`Ya existe una variante con el SKU: ${dto.sku}`);
      }
    }

    // Actualizar la variante (SIN campos de stock legacy - usar ProductoStockRepository)
    const variante = await this.prisma.productoVariante.update({
      where: { id: varianteId },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.sku && { sku: dto.sku }),
        ...(dto.codigoBarras !== undefined && { codigoBarras: dto.codigoBarras }),
        ...(dto.peso !== undefined && { peso: dto.peso }),
        ...(dto.dimensiones && { dimensiones: dto.dimensiones }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.orden !== undefined && { orden: dto.orden }),
      },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
    });

    // Actualizar atributos si se proporcionaron
    if (dto.atributosEstructurados !== undefined) {
      // Eliminar atributos existentes
      await this.prisma.productoAtributoValor.deleteMany({
        where: { varianteId: varianteId },
      });

      // Crear nuevos atributos si hay
      if (dto.atributosEstructurados.length > 0) {
        await this.createVarianteAtributosFromStructured(varianteId, empresaId, dto.atributosEstructurados);
      }

      // Recargar variante con nuevos atributos
      const varianteConAtributos = await this.prisma.productoVariante.findUnique({
        where: { id: varianteId },
        include: {
          archivos: {
            where: { deletedAt: null },
            orderBy: { orden: 'asc' },
          },
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
          stocksPorSede: {
            select: {
              stockActual: true,
              sede: {
                select: {
                  id: true,
                  nombre: true,
                  codigo: true,
                },
              },
            },
          },
        },
      });

      if (varianteConAtributos) {
        Object.assign(variante, varianteConAtributos);
      }
    }

    // Actualizar imágenes si se proporcionaron
    if (dto.imagenesIds !== undefined) {
      // Desvincular imágenes anteriores
      await this.prisma.archivo.updateMany({
        where: {
          varianteId: varianteId,
        },
        data: {
          varianteId: null,
        },
      });

      // Vincular nuevas imágenes
      if (dto.imagenesIds.length > 0) {
        await this.prisma.archivo.updateMany({
          where: {
            id: { in: dto.imagenesIds },
            empresaId,
          },
          data: {
            varianteId: variante.id,
            entidadTipo: 'PRODUCTO_VARIANTE',
            entidadId: variante.id,
          },
        });
      }
    }

    // Invalidar cache de productos (las variantes afectan el stock total y datos del producto)
    await this.cache.invalidateProductosLists(empresaId);

    this.logger.success('Variant updated', { varianteId });

    return this.mapToResponseDto(variante);
  }

  /**
   * Crea atributos estructurados a partir de un array de VarianteAtributoDto
   * (Formato recomendado para nuevos desarrollos)
   */
  private async createVarianteAtributosFromStructured(
    varianteId: string,
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
      varianteId,
      atributoId: a.atributoId,
      valor: String(a.valor),
    }));

    await this.prisma.productoAtributoValor.createMany({
      data: valoresAtributos,
      skipDuplicates: true,
    });

    this.logger.debug(`Creados ${valoresAtributos.length} valores de atributos estructurados para variante ${varianteId}`);
  }

  /**
   * Eliminar una variante (soft delete)
   */
  async remove(varianteId: string, empresaId: string): Promise<void> {
    this.logger.info('Deleting variant', { varianteId, empresaId });

    const variante = await this.prisma.productoVariante.findFirst({
      where: {
        id: varianteId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    await this.prisma.productoVariante.update({
      where: { id: varianteId },
      data: { deletedAt: new Date() },
    });

    // Invalidar cache de productos
    await this.cache.invalidateProductosLists(empresaId);

    this.logger.success('Variant deleted', { varianteId });
  }

  /**
   * @deprecated Este método está deprecated. Use ProductoStockRepository.ajustarStock() en su lugar.
   * El sistema legacy de stock global ha sido reemplazado por ProductoStock (stock por sede).
   *
   * @throws BadRequestException siempre
   */
  async updateStock(
    varianteId: string,
    empresaId: string,
    cantidad: number,
  ): Promise<ProductoVarianteResponseDto> {
    throw new BadRequestException(
      'Este método está deprecated. Use ProductoStockRepository.ajustarStock() para gestionar stock por sede. ' +
      'El sistema de stock global ha sido eliminado en favor del sistema multi-sede.'
    );
  }

  /**
   * NOTA: El método generateCodigoEmpresa() ha sido migrado a ConfiguracionCodigosService
   * para centralizar toda la lógica de generación de códigos.
   *
   * Usar: configCodigosService.generarCodigoVariante()
   */

  /**
   * Mapear a DTO de respuesta (formato estructurado)
   */
  private mapToResponseDto(variante: any): ProductoVarianteResponseDto {
    // Calcular stock total y precios desde ProductoStock (sistema multi-sede)
    let stockTotal = 0;
    let stocksPorSede: any[] | undefined = undefined;
    let precioFinal = 0;
    let precioCostoFinal: number | undefined = undefined;
    let precioOfertaFinal: number | undefined = undefined;

    if (variante.stocksPorSede && variante.stocksPorSede.length > 0) {
      // Calcular total sumando todas las sedes
      stockTotal = variante.stocksPorSede.reduce(
        (sum: number, stock: any) => sum + stock.stockActual,
        0,
      );

      // Obtener precio del primer stock con precio configurado
      const stockConPrecio = variante.stocksPorSede.find(
        (s: any) => s.precioConfigurado && s.precio != null,
      );
      if (stockConPrecio) {
        precioFinal = Number(stockConPrecio.precio);
        precioCostoFinal = stockConPrecio.precioCosto ? Number(stockConPrecio.precioCosto) : undefined;
        precioOfertaFinal = stockConPrecio.precioOferta ? Number(stockConPrecio.precioOferta) : undefined;
      }

      // Preparar desglose por sede (incluyendo precios)
      stocksPorSede = variante.stocksPorSede.map((stock: any) => ({
        sedeId: stock.sede.id,
        sedeNombre: stock.sede.nombre,
        sedeCodigo: stock.sede.codigo,
        cantidad: stock.stockActual,
        precio: stock.precio ? Number(stock.precio) : undefined,
        precioCosto: stock.precioCosto ? Number(stock.precioCosto) : undefined,
        precioOferta: stock.precioOferta ? Number(stock.precioOferta) : undefined,
        enOferta: stock.enOferta ?? false,
        precioConfigurado: stock.precioConfigurado ?? false,
      }));
    }

    return {
      id: variante.id,
      productoId: variante.productoId,
      empresaId: variante.empresaId,
      nombre: variante.nombre,
      sku: variante.sku,
      codigoBarras: variante.codigoBarras,
      codigoEmpresa: variante.codigoEmpresa,
      atributosValores: variante.atributosValores?.map((av: any) => ({
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
      precio: precioFinal,
      precioCosto: precioCostoFinal,
      precioOferta: precioOfertaFinal,
      stock: stockTotal,
      stocksPorSede: stocksPorSede,
      peso: variante.peso ? Number(variante.peso) : undefined,
      dimensiones: variante.dimensiones as Record<string, number> | undefined,
      isActive: variante.isActive,
      orden: variante.orden,
      archivos: variante.archivos?.map((a: any) => ({
        id: a.id,
        url: a.url,
        urlThumbnail: a.urlThumbnail,
        orden: a.orden,
      })),
      creadoEn: variante.creadoEn,
      actualizadoEn: variante.actualizadoEn,
    };
  }

  /**
   * Copia niveles de precio de otra variante del mismo producto a una nueva variante
   * Se usa para mantener consistencia en descuentos al crear nuevas variantes
   */
  private async copiarNivelesDeOtraVariante(
    productoId: string,
    nuevaVarianteId: string,
  ): Promise<void> {
    // Buscar una variante existente del mismo producto que tenga niveles de precio
    const varianteConNiveles = await this.prisma.productoVariante.findFirst({
      where: {
        productoId,
        id: { not: nuevaVarianteId },
        deletedAt: null,
      },
      include: {
        preciosNivel: {
          where: { isActive: true },
          orderBy: { orden: 'asc' },
        },
      },
    });

    // Si no hay variantes con niveles, no hacer nada
    if (!varianteConNiveles?.preciosNivel?.length) {
      this.logger.debug(
        `No hay variantes con niveles de precio para copiar a variante ${nuevaVarianteId}`,
      );
      return;
    }

    this.logger.info(
      `Copiando ${varianteConNiveles.preciosNivel.length} niveles de precio de variante ${varianteConNiveles.id} a variante ${nuevaVarianteId}`,
    );

    // Copiar niveles a la nueva variante
    const nivelesParaCopiar = varianteConNiveles.preciosNivel.map((nivel) => ({
      varianteId: nuevaVarianteId,
      productoId: null, // Los niveles pertenecen a la variante, no al producto
      nombre: nivel.nombre,
      cantidadMinima: nivel.cantidadMinima,
      cantidadMaxima: nivel.cantidadMaxima,
      tipoPrecio: nivel.tipoPrecio,
      precio: nivel.precio,
      porcentajeDesc: nivel.porcentajeDesc,
      descripcion: nivel.descripcion,
      orden: nivel.orden,
      isActive: true,
    }));

    await this.prisma.precioNivel.createMany({
      data: nivelesParaCopiar,
    });

    this.logger.success(
      `${nivelesParaCopiar.length} niveles de precio copiados exitosamente a variante ${nuevaVarianteId}`,
    );
  }

  // =====================================================
  // GENERACIÓN AUTOMÁTICA DE COMBINACIONES DE VARIANTES
  // =====================================================

  /**
   * Genera variantes automáticamente a partir del producto cartesiano de atributos seleccionados.
   * Ej: Conexión [USB, BT] × Color [Negro, Blanco] = 4 variantes
   */
  async generarCombinaciones(
    productoId: string,
    empresaId: string,
    dto: GenerateVarianteCombinationsDto,
  ): Promise<ProductoVarianteResponseDto[]> {
    this.logger.info('Generating variant combinations', { productoId, empresaId, atributos: dto.atributos.length });

    // Verificar que el producto existe y tiene variantes habilitadas
    const producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    if (!producto.tieneVariantes) {
      throw new BadRequestException('El producto no tiene variantes habilitadas');
    }

    if (!producto.isActive) {
      throw new BadRequestException(
        'No se pueden generar variantes cuando el producto padre está inactivo. Active primero el producto padre.',
      );
    }

    // Validar que todos los atributos pertenecen a la empresa y están activos
    const atributoIds = dto.atributos.map(a => a.atributoId);
    const atributosDb = await this.prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
        isActive: true,
      },
    });

    if (atributosDb.length !== atributoIds.length) {
      const encontrados = new Set(atributosDb.map(a => a.id));
      const noEncontrados = atributoIds.filter(id => !encontrados.has(id));
      throw new BadRequestException(
        `Los siguientes atributos no existen o no están activos: ${noEncontrados.join(', ')}`,
      );
    }

    // Validar que cada valor está dentro de atributo.valores[]
    const atributosMap = new Map(atributosDb.map(a => [a.id, a]));
    for (const atributoDto of dto.atributos) {
      const atributo = atributosMap.get(atributoDto.atributoId)!;
      if (atributo.valores && atributo.valores.length > 0) {
        const valoresInvalidos = atributoDto.valores.filter(v => !atributo.valores.includes(v));
        if (valoresInvalidos.length > 0) {
          throw new BadRequestException(
            `Valores inválidos para atributo "${atributo.nombre}": ${valoresInvalidos.join(', ')}. Valores permitidos: ${atributo.valores.join(', ')}`,
          );
        }
      }
    }

    // Generar producto cartesiano
    const valoresArrays = dto.atributos.map(a => a.valores);
    const combinaciones = this.cartesianProduct(valoresArrays);

    if (combinaciones.length === 0) {
      throw new BadRequestException('No se generaron combinaciones. Seleccione al menos un valor por atributo.');
    }

    if (combinaciones.length > 50) {
      throw new BadRequestException(
        `Se generarían ${combinaciones.length} combinaciones, el máximo permitido es 50. Reduzca la cantidad de valores seleccionados.`,
      );
    }

    // Verificar que no existan variantes duplicadas (misma combinación de atributos)
    const variantesExistentes = await this.prisma.productoVariante.findMany({
      where: {
        productoId,
        empresaId,
        deletedAt: null,
      },
      include: {
        atributosValores: {
          select: { atributoId: true, valor: true },
        },
      },
    });

    // Crear un set de combinaciones existentes para comparación
    const combinacionesExistentes = new Set(
      variantesExistentes.map(v => {
        const sorted = [...v.atributosValores]
          .sort((a, b) => a.atributoId.localeCompare(b.atributoId))
          .map(av => `${av.atributoId}:${av.valor}`)
          .join('|');
        return sorted;
      }),
    );

    // Verificar duplicados
    const combinacionesNuevas: string[][] = [];
    for (const combo of combinaciones) {
      const key = dto.atributos
        .map((a, i) => `${a.atributoId}:${combo[i]}`)
        .sort()
        .join('|');

      if (combinacionesExistentes.has(key)) {
        const nombre = combo.map((valor, idx) => {
          const atributo = atributosMap.get(dto.atributos[idx].atributoId)!;
          return `${atributo.nombre} ${valor}`;
        }).join(' / ');
        throw new ConflictException(
          `Ya existe una variante con la combinación: ${nombre}`,
        );
      }
      combinacionesNuevas.push(combo);
    }

    // Crear variantes dentro de una transacción (solo inserts, sin recargas pesadas)
    // Timeout extendido: ~2s por variante (máximo 50 variantes = 100s)
    const txTimeout = Math.max(15000, combinacionesNuevas.length * 2000);
    const varianteIds = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      for (let i = 0; i < combinacionesNuevas.length; i++) {
        const combo = combinacionesNuevas[i];
        const nombre = combo.map((valor, idx) => {
          const atributo = atributosMap.get(dto.atributos[idx].atributoId)!;
          return `${atributo.nombre} ${valor}`;
        }).join(' / ');

        // Generar código de empresa único
        const { codigoEmpresa } = await this.configCodigosService.generarCodigoVariante(empresaId, tx);

        // Generar SKU
        const sku = dto.skuBase
          ? `${dto.skuBase}-${i + 1}`
          : `${codigoEmpresa}`;

        // Crear la variante
        const variante = await tx.productoVariante.create({
          data: {
            productoId,
            empresaId,
            nombre,
            sku,
            codigoEmpresa,
            isActive: true,
            orden: variantesExistentes.length + i,
          },
        });

        // Crear los valores de atributos
        const atributosValoresData = dto.atributos.map((atributoDto, attrIndex) => ({
          varianteId: variante.id,
          atributoId: atributoDto.atributoId,
          valor: combo[attrIndex],
        }));

        await tx.productoAtributoValor.createMany({
          data: atributosValoresData,
          skipDuplicates: true,
        });

        ids.push(variante.id);
      }

      return ids;
    }, { timeout: txTimeout });

    // Copiar niveles de precio fuera de la transacción
    for (const varianteId of varianteIds) {
      await this.copiarNivelesDeOtraVariante(productoId, varianteId);
    }

    // Crear ProductoStock en las sedes correspondientes para cada variante
    for (const varianteId of varianteIds) {
      await this.crearProductoStockEnSedes(varianteId, productoId, empresaId);
    }

    // Recargar variantes con relaciones completas (fuera de la transacción)
    const variantesCreadas = await this.prisma.productoVariante.findMany({
      where: { id: { in: varianteIds } },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
    });

    // Invalidar cache
    await this.cache.invalidateProductosLists(empresaId);

    this.logger.success(`${variantesCreadas.length} variant combinations generated`, { productoId });

    return variantesCreadas.map((v) => this.mapToResponseDto(v));
  }

  /**
   * Genera el producto cartesiano de múltiples arrays
   * Ej: [["USB","BT"], ["Negro","Blanco"]] → [["USB","Negro"],["USB","Blanco"],["BT","Negro"],["BT","Blanco"]]
   */
  private cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [];
    return arrays.reduce<string[][]>(
      (acc, curr) => {
        const result: string[][] = [];
        for (const a of acc) {
          for (const b of curr) {
            result.push([...a, b]);
          }
        }
        return result;
      },
      [[]],
    );
  }

  // =====================================================
  // CREACIÓN AUTOMÁTICA DE PRODUCTOSTOCK PARA VARIANTES
  // =====================================================

  /**
   * Recarga una variante con todas sus relaciones completas
   */
  private async recargarVariante(varianteId: string) {
    return this.prisma.productoVariante.findUnique({
      where: { id: varianteId },
      include: {
        archivos: {
          where: { deletedAt: null },
          orderBy: { orden: 'asc' },
        },
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
        stocksPorSede: {
          select: {
            stockActual: true,
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
      },
    });
  }

  /**
   * Crea registros de ProductoStock para una variante en todas las sedes
   * donde el producto base ya tiene stock.
   * Si el producto base no tiene stock en ninguna sede, crea en todas las sedes activas de la empresa.
   * Los registros se crean con stock=0 y sin precio (precioConfigurado=false).
   */
  private async crearProductoStockEnSedes(
    varianteId: string,
    productoId: string,
    empresaId: string,
  ): Promise<void> {
    try {
      // Buscar sedes donde el producto base tiene stock
      const stocksProductoBase = await this.prisma.productoStock.findMany({
        where: {
          productoId,
          empresaId,
        },
        select: { sedeId: true },
      });

      let sedeIds: string[];

      if (stocksProductoBase.length > 0) {
        // Usar las mismas sedes del producto base
        sedeIds = stocksProductoBase.map(s => s.sedeId);
      } else {
        // Si el producto base no tiene stock, usar todas las sedes activas
        const sedesActivas = await this.prisma.sede.findMany({
          where: { empresaId, isActive: true },
          select: { id: true },
        });
        sedeIds = sedesActivas.map(s => s.id);
      }

      if (sedeIds.length === 0) return;

      // Crear registros de ProductoStock para la variante en cada sede
      await this.prisma.productoStock.createMany({
        data: sedeIds.map(sedeId => ({
          sedeId,
          empresaId,
          varianteId,
          stockActual: 0,
          precioConfigurado: false,
        })),
        skipDuplicates: true,
      });

      this.logger.debug(
        `ProductoStock creado para variante ${varianteId} en ${sedeIds.length} sede(s)`,
      );
    } catch (error) {
      // No fallar la creación de variante si falla la creación de stock
      this.logger.warn(
        `Error creando ProductoStock para variante ${varianteId}: ${error.message}`,
      );
    }
  }

  // =====================================================
  // MÉTODOS PARA CONVERSIÓN A VARIANTES (NUEVOS)
  // =====================================================

  /**
   * Crea una variante por defecto cuando se habilita tieneVariantes en un producto
   * Migra los datos del producto base a la nueva variante (excepto stock).
   * IMPORTANTE: El stock se migra separadamente usando migrarProductoStockAVariante()
   *
   * @param productoId ID del producto que se está convirtiendo a variantes
   * @param empresaId ID de la empresa
   * @param productoData Datos del producto base para copiar
   * @param generateCodigoFn Función para generar código de variante (inyectada para evitar circular)
   * @param tx Transacción de Prisma (opcional)
   * @returns ID de la variante creada y su código
   */
  async createVariantePorDefecto(
    productoId: string,
    empresaId: string,
    productoData: {
      nombre: string;
      peso?: any;
      dimensiones?: any;
      codigoEmpresa: string;
    },
    generateCodigoFn: (empresaId: string, tx?: Prisma.TransactionClient) => Promise<{ codigoEmpresa: string }>,
    tx?: Prisma.TransactionClient,
  ): Promise<{ varianteId: string; codigoEmpresa: string }> {
    const prisma = tx || this.prisma;

    // Verificar que no tenga variantes ya creadas (edge case)
    const variantesExistentes = await prisma.productoVariante.count({
      where: {
        productoId,
        deletedAt: null,
      },
    });

    if (variantesExistentes > 0) {
      this.logger.warn(`El producto ${productoId} ya tiene variantes, no se creará variante por defecto`);
      throw new BadRequestException('El producto ya tiene variantes creadas');
    }

    this.logger.info('Creando variante por defecto (sin precio)', {
      productoId,
      // Los precios se configurarán en ProductoStock después
    });

    // Generar código único para la variante
    const { codigoEmpresa } = await generateCodigoFn(empresaId, tx);

    // Crear variante por defecto con los datos del producto original (sin stock)
    // El stock se migra usando migrarProductoStockAVariante() después de crear la variante
    let variantePorDefecto;
    try {
      variantePorDefecto = await prisma.productoVariante.create({
        data: {
          productoId,
          empresaId,
          nombre: productoData.nombre,
          sku: `${productoData.codigoEmpresa}-BASE`,
          codigoBarras: null,
          codigoEmpresa,
              peso: productoData.peso,
          dimensiones: productoData.dimensiones as any,
          isActive: true,
          orden: 0,
        },
      });
    } catch (error: any) {
      // Si falla por código duplicado, reintentar con un nuevo código
      if (error.code === 'P2002' && error.meta?.target?.includes('codigoEmpresa')) {
        this.logger.warn(`Código de variante duplicado ${codigoEmpresa}, generando nuevo código`);
        const { codigoEmpresa: nuevoCodigo } = await generateCodigoFn(empresaId, tx);
        variantePorDefecto = await prisma.productoVariante.create({
          data: {
            productoId,
            empresaId,
            nombre: productoData.nombre,
            sku: `${productoData.codigoEmpresa}-BASE`,
            codigoBarras: null,
            codigoEmpresa: nuevoCodigo,
                  peso: productoData.peso,
            dimensiones: productoData.dimensiones as any,
            isActive: true,
            orden: 0,
          },
        });
      } else {
        throw error;
      }
    }

    this.logger.success('Variante por defecto creada exitosamente', {
      varianteId: variantePorDefecto.id,
      codigoEmpresa: variantePorDefecto.codigoEmpresa,
    });

    return {
      varianteId: variantePorDefecto.id,
      codigoEmpresa: variantePorDefecto.codigoEmpresa,
    };
  }

  /**
   * Migra atributos de un producto base a una variante
   * Actualiza los registros de ProductoAtributoValor para que apunten a la variante en lugar del producto
   * @param productoId ID del producto origen
   * @param varianteId ID de la variante destino
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   */
  async migrarAtributosProductoAVariante(
    productoId: string,
    varianteId: string,
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    // Obtener todos los atributos del producto base
    const atributosProducto = await prisma.productoAtributoValor.findMany({
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
        await prisma.productoAtributoValor.update({
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
   * Migra registros de ProductoStock de un producto base a una variante
   * Esto se ejecuta cuando se habilitan variantes y se crea la variante por defecto
   * Preserva el stock de todas las sedes y genera movimientos de auditoría
   *
   * @param productoId ID del producto origen
   * @param varianteId ID de la variante destino
   * @param empresaId ID de la empresa
   * @param usuarioId ID del usuario que realiza la operación
   * @param tx Transacción de Prisma (opcional)
   */
  async migrarProductoStockAVariante(
    productoId: string,
    varianteId: string,
    empresaId: string,
    usuarioId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    // Buscar todos los ProductoStock del producto
    const stocksDelProducto = await prisma.productoStock.findMany({
      where: {
        productoId,
        empresaId,
        varianteId: null,
      },
      include: {
        sede: {
          select: {
            nombre: true,
          },
        },
      },
    });

    if (stocksDelProducto.length === 0) {
      this.logger.debug(`No hay registros de ProductoStock para migrar del producto ${productoId} a variante ${varianteId}`);
      return;
    }

    this.logger.info(`Migrando ${stocksDelProducto.length} registros de ProductoStock del producto ${productoId} a variante ${varianteId}`);

    // Migrar cada registro a la variante
    for (const stock of stocksDelProducto) {
      // Actualizar ProductoStock: desvincular del producto y vincular a variante
      await prisma.productoStock.update({
        where: { id: stock.id },
        data: {
          productoId: null,     // Quitar del producto
          varianteId: varianteId, // Asignar a variante
        },
      });

      // Registrar movimiento de auditoría (sin cambio de cantidad)
      await prisma.movimientoStock.create({
        data: {
          sedeId: stock.sedeId,
          empresaId,
          productoStockId: stock.id,
          tipo: 'ENTRADA_AJUSTE',
          tipoDocumento: 'MIGRACION_VARIANTE',
          cantidadAnterior: stock.stockActual,
          cantidad: 0, // No cambia cantidad
          cantidadNueva: stock.stockActual,
          motivo: `Migración de stock al habilitar variantes en producto. Stock preservado en variante por defecto.`,
          observaciones: `Sede: ${stock.sede.nombre} | Stock migrado: ${stock.stockActual} unidades`,
          usuarioId,
        },
      });

      this.logger.debug(
        `Stock migrado en sede ${stock.sede.nombre}: ${stock.stockActual} unidades (ProductoStock ID: ${stock.id})`,
      );
    }

    this.logger.info(`Migración completada: ${stocksDelProducto.length} registros de ProductoStock migrados exitosamente`);
  }
}
