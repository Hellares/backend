import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { ProductoVarianteResponseDto } from './dto/producto-variante-response.dto';

@Injectable()
export class ProductoVarianteService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
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

    // Validar que el precio sea válido
    if (!dto.precio || dto.precio <= 0) {
      throw new BadRequestException(
        'El precio de la variante debe ser mayor a 0',
      );
    }

    // Generar código de empresa único
    const codigoEmpresa = await this.generateCodigoEmpresa(empresaId);

    // Crear la variante (SIN campo atributos)
    const variante = await this.prisma.productoVariante.create({
      data: {
        productoId,
        empresaId,
        nombre: dto.nombre,
        sku: dto.sku,
        codigoBarras: dto.codigoBarras,
        codigoEmpresa,
        precio: dto.precio,
        precioCosto: dto.precioCosto,
        precioOferta: dto.precioOferta,
        stock: dto.stock ?? 0,
        stockMinimo: dto.stockMinimo,
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

    this.logger.success('Product variant created', { varianteId: variante.id });

    return this.mapToResponseDto(variante);
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

    // Actualizar la variante (SIN campo atributos)
    const variante = await this.prisma.productoVariante.update({
      where: { id: varianteId },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.sku && { sku: dto.sku }),
        ...(dto.codigoBarras !== undefined && { codigoBarras: dto.codigoBarras }),
        ...(dto.precio !== undefined && { precio: dto.precio }),
        ...(dto.precioCosto !== undefined && { precioCosto: dto.precioCosto }),
        ...(dto.precioOferta !== undefined && { precioOferta: dto.precioOferta }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.stockMinimo !== undefined && { stockMinimo: dto.stockMinimo }),
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

    this.logger.success('Variant updated', { varianteId });

    return this.mapToResponseDto(variante);
  }

  /**
   * Crea atributos estructurados para una variante
   * Convierte el formato JSON libre a la tabla ProductoAtributoValor
   */
  private async createVarianteAtributos(
    varianteId: string,
    empresaId: string,
    atributos: Record<string, any>,
  ): Promise<void> {
    // Obtener todos los atributos configurados para esta empresa
    const atributosDisponibles = await this.prisma.productoAtributo.findMany({
      where: {
        empresaId,
        isActive: true,
      },
    });

    if (atributosDisponibles.length === 0) {
      this.logger.warn(`No hay atributos configurados para empresa ${empresaId}. No se crearán valores de atributos.`);
      return;
    }

    // Crear un mapa clave -> atributo para búsqueda rápida
    const atributosMap = new Map(
      atributosDisponibles.map(attr => [attr.clave.toLowerCase(), attr])
    );

    // Crear los valores de atributos
    const valoresAtributos = Object.entries(atributos)
      .map(([clave, valor]) => {
        const atributo = atributosMap.get(clave.toLowerCase());
        
        if (!atributo) {
          this.logger.warn(`Atributo con clave "${clave}" no encontrado en empresa ${empresaId}. Ignorando.`);
          return null;
        }

        return {
          varianteId,
          atributoId: atributo.id,
          valor: String(valor), // Siempre convertir a string
        };
      })
      .filter(Boolean); // Filtrar nulos

    if (valoresAtributos.length > 0) {
      await this.prisma.productoAtributoValor.createMany({
        data: valoresAtributos as any[],
        skipDuplicates: true,
      });

      this.logger.debug(`Creados ${valoresAtributos.length} valores de atributos para variante ${varianteId}`);
    }
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

    this.logger.success('Variant deleted', { varianteId });
  }

  /**
   * Actualizar stock de una variante
   */
  async updateStock(
    varianteId: string,
    empresaId: string,
    cantidad: number,
  ): Promise<ProductoVarianteResponseDto> {
    this.logger.info('Updating variant stock', { varianteId, cantidad });

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

    const newStock = variante.stock + cantidad;

    if (newStock < 0) {
      throw new BadRequestException('El stock no puede ser negativo');
    }

    const updated = await this.prisma.productoVariante.update({
      where: { id: varianteId },
      data: { stock: newStock },
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
      },
    });

    this.logger.success('Variant stock updated', { varianteId, newStock });

    return this.mapToResponseDto(updated);
  }

  /**
   * Generar código único de empresa para variante
   * Usa incremento atómico en ConfiguracionCodigos para garantizar unicidad
   */
  private async generateCodigoEmpresa(empresaId: string): Promise<string> {
    // Obtener o crear configuración de códigos
    let config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      // Crear configuración por defecto
      config = await this.prisma.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Incrementar contador atómicamente (evita race conditions)
    const updated = await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaVariante: {
          increment: 1,
        },
      },
    });

    const nuevoContador = updated.ultimaVariante;

    // Generar código usando la configuración
    const numero = nuevoContador.toString().padStart(config.varianteLongitud, '0');
    const codigoEmpresa = `${config.varianteCodigo}${config.varianteSeparador}${numero}`;

    return codigoEmpresa;
  }

  /**
   * Mapear a DTO de respuesta (formato estructurado)
   */
  private mapToResponseDto(variante: any): ProductoVarianteResponseDto {
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
      precio: Number(variante.precio),
      precioCosto: variante.precioCosto ? Number(variante.precioCosto) : undefined,
      precioOferta: variante.precioOferta ? Number(variante.precioOferta) : undefined,
      stock: variante.stock,
      stockMinimo: variante.stockMinimo,
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
}
