import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class ProductoService {
  private readonly logger = new Logger(ProductoService.name);

  constructor(private prisma: PrismaService) {}

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

    // Generar códigos únicos
    const { codigoEmpresa, codigoSistema } = await this.generateCodigos(
      empresaId,
      createDto.sedeId,
    );

    try {
      // Crear producto
      const producto = await this.prisma.producto.create({
        data: {
          ...productoData,
          empresaId,
          codigoEmpresa,
          codigoSistema,
          stock: productoData.stock ?? 0,
          visibleMarketplace: productoData.visibleMarketplace ?? true,
          destacado: productoData.destacado ?? false,
          enOferta: productoData.enOferta ?? false,
        },
        include: {
          categoria: true,
          marca: true,
          sede: true,
        },
      });

      // Asociar imágenes si se proporcionaron
      if (imagenesIds && imagenesIds.length > 0) {
        await this.asociarImagenes(producto.id, empresaId, imagenesIds);
      }

      this.logger.log(
        `Producto creado: ${producto.id} (${producto.codigoEmpresa})`,
      );

      return this.toResponseDto(producto);
    } catch (error) {
      this.logger.error(`Error al crear producto: ${error.message}`);
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
      categoriaId,
      marcaId,
      sedeId,
      visibleMarketplace,
      destacado,
      enOferta,
      stockBajo,
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

    if (categoriaId) where.categoriaId = categoriaId;
    if (marcaId) where.marcaId = marcaId;
    if (sedeId) where.sedeId = sedeId;
    if (visibleMarketplace !== undefined)
      where.visibleMarketplace = visibleMarketplace;
    if (destacado !== undefined) where.destacado = destacado;
    if (enOferta !== undefined) where.enOferta = enOferta;

    // Filtro de stock bajo
    if (stockBajo) {
      where.AND = [
        { stock: { lte: this.prisma.producto.fields.stockMinimo } },
      ];
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
          categoria: { select: { id: true, nombre: true } },
          marca: { select: { id: true, nombre: true } },
          sede: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Obtener imágenes para cada producto
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

        return this.toResponseDto(producto, archivos);
      }),
    );

    return {
      data: productosConImagenes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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
        categoria: true,
        marca: true,
        sede: true,
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

    try {
      // Actualizar producto
      const producto = await this.prisma.producto.update({
        where: { id },
        data: productoData,
        include: {
          categoria: true,
          marca: true,
          sede: true,
        },
      });

      // Actualizar imágenes si se proporcionaron
      if (imagenesIds !== undefined) {
        await this.actualizarImagenes(id, empresaId, imagenesIds);
      }

      this.logger.log(`Producto actualizado: ${id}`);

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
      this.logger.error(`Error al actualizar producto: ${error.message}`);
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
        categoria: true,
        marca: true,
        sede: true,
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

  private async generateCodigos(empresaId: string, sedeId?: string) {
    // Obtener configuración de códigos
    let config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      // Crear configuración por defecto
      config = await this.prisma.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Incrementar contador
    const nuevoContador = config.ultimoProducto + 1;

    await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoProducto: nuevoContador },
    });

    // Generar códigos
    const numero = nuevoContador.toString().padStart(config.productoLongitud, '0');
    let codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${numero}`;

    if (config.productoIncluirSede && sedeId) {
      const sede = await this.prisma.sede.findUnique({
        where: { id: sedeId },
        select: { nombre: true },
      });
      if (sede) {
        const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
        codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${sedeCode}${config.productoSeparador}${numero}`;
      }
    }

    const codigoSistema = `${empresaId.substring(0, 8)}-PROD-${numero}`;

    return { codigoEmpresa, codigoSistema };
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
    return {
      ...producto,
      precio: Number(producto.precio),
      precioCosto: producto.precioCosto
        ? Number(producto.precioCosto)
        : undefined,
      peso: producto.peso ? Number(producto.peso) : undefined,
      precioOferta: producto.precioOferta
        ? Number(producto.precioOferta)
        : undefined,
      imagenes: archivos?.map((a) => a.url) || [],
      archivos: archivos?.map((a) => ({
        id: a.id,
        url: a.url,
        urlThumbnail: a.urlThumbnail,
        categoria: a.categoria,
        orden: a.orden,
      })),
    };
  }
}
