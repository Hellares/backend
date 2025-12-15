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

    // Crear la variante
    const variante = await this.prisma.productoVariante.create({
      data: {
        productoId,
        empresaId,
        nombre: dto.nombre,
        sku: dto.sku,
        codigoBarras: dto.codigoBarras,
        codigoEmpresa,
        atributos: dto.atributos,
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
      },
    });

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

    // Actualizar la variante
    const variante = await this.prisma.productoVariante.update({
      where: { id: varianteId },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.sku && { sku: dto.sku }),
        ...(dto.codigoBarras !== undefined && { codigoBarras: dto.codigoBarras }),
        ...(dto.atributos && { atributos: dto.atributos }),
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
      },
    });

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
   * Mapear a DTO de respuesta
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
      atributos: variante.atributos as Record<string, any>,
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
}
