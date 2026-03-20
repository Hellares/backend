import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgregarCarritoDto } from './dto/carrito.dto';

@Injectable()
export class CarritoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcular stock disponible
   */
  private calcularDisponible(stock: any): number {
    if (!stock) return 0;
    return Math.max(
      0,
      stock.stockActual - stock.stockReservado
        - stock.stockReservadoVenta - stock.stockDanado - stock.stockEnGarantia,
    );
  }

  /**
   * Obtener carrito del usuario agrupado por empresa
   * Optimizado: 3 queries en vez de 2N+1
   */
  async getCarrito(usuarioId: string) {
    const items = await this.prisma.carritoItem.findMany({
      where: { usuarioId },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
            sku: true,
            tieneVariantes: true,
            isActive: true,
            visibleMarketplace: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
            isActive: true,
          },
        },
        empresa: {
          select: {
            id: true,
            nombre: true,
            logo: true,
            subdominio: true,
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    if (items.length === 0) {
      return { empresas: [], totalItems: 0, totalCantidad: 0, total: 0 };
    }

    // Batch: obtener todos los stocks e imágenes en 2 queries
    const productoIds = items.filter(i => !i.varianteId).map(i => i.productoId);
    const varianteIds = items.filter(i => i.varianteId).map(i => i.varianteId!);
    const allEntityIds = [...new Set([...productoIds, ...varianteIds])];

    const [allStocks, allImagenes] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          OR: [
            ...(productoIds.length > 0 ? [{ productoId: { in: productoIds }, varianteId: null }] : []),
            ...(varianteIds.length > 0 ? [{ varianteId: { in: varianteIds } }] : []),
          ],
        },
        select: {
          productoId: true,
          varianteId: true,
          precio: true,
          precioOferta: true,
          enOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          stockActual: true,
          stockReservado: true,
          stockReservadoVenta: true,
          stockDanado: true,
          stockEnGarantia: true,
          envioGratis: true,
        },
      }),
      this.prisma.archivo.findMany({
        where: {
          entidadId: { in: allEntityIds },
          entidadTipo: { in: ['PRODUCTO', 'PRODUCTO_VARIANTE'] },
          tipoArchivo: 'IMAGEN',
          isActive: true,
          deletedAt: null,
        },
        select: { entidadId: true, url: true, urlThumbnail: true, orden: true },
        orderBy: { orden: 'asc' },
      }),
    ]);

    // Crear lookup maps para O(1)
    const stockMap = new Map<string, any>();
    for (const s of allStocks) {
      const key = s.varianteId ?? s.productoId;
      if (key) stockMap.set(key, s);
    }

    const imageMap = new Map<string, any>();
    for (const img of allImagenes) {
      // Solo la primera imagen por entidad (ya ordenadas por orden asc)
      if (!imageMap.has(img.entidadId)) {
        imageMap.set(img.entidadId, img);
      }
    }

    // Enriquecer items sin queries adicionales
    const now = new Date();
    const enrichedItems = items.map((item) => {
      const lookupKey = item.varianteId ?? item.productoId;
      const stock = stockMap.get(lookupKey);
      const imagen = imageMap.get(lookupKey);

      const ofertaActiva = stock?.enOferta
        && stock.precioOferta
        && (!stock.fechaInicioOferta || stock.fechaInicioOferta <= now)
        && (!stock.fechaFinOferta || stock.fechaFinOferta >= now);

      const precioUnitario = ofertaActiva
        ? Number(stock.precioOferta)
        : stock?.precio ? Number(stock.precio) : 0;

      const stockDisponible = this.calcularDisponible(stock);
      const productoActivo = item.producto.isActive && item.producto.visibleMarketplace;

      return {
        id: item.id,
        productoId: item.productoId,
        varianteId: item.varianteId,
        empresaId: item.empresaId,
        cantidad: item.cantidad,
        productoNombre: item.producto.nombre,
        varianteNombre: item.variante?.nombre ?? null,
        precioUnitario,
        precioOferta: ofertaActiva ? Number(stock.precioOferta) : null,
        precioNormal: stock?.precio ? Number(stock.precio) : 0,
        subtotal: precioUnitario * item.cantidad,
        imagenUrl: imagen?.urlThumbnail ?? imagen?.url ?? null,
        thumbnailUrl: imagen?.urlThumbnail ?? null,
        stockDisponible,
        disponible: productoActivo && stockDisponible >= item.cantidad,
        envioGratis: stock?.envioGratis ?? false,
        empresa: item.empresa,
      };
    });

    // Agrupar por empresa
    const empresasMap = new Map<string, any>();

    for (const item of enrichedItems) {
      if (!empresasMap.has(item.empresaId)) {
        empresasMap.set(item.empresaId, {
          empresa: item.empresa,
          items: [],
          subtotal: 0,
        });
      }
      const grupo = empresasMap.get(item.empresaId);
      grupo.items.push(item);
      grupo.subtotal += item.subtotal;
    }

    const empresas = Array.from(empresasMap.values()).map((g) => ({
      ...g,
      subtotal: Math.round(g.subtotal * 100) / 100,
    }));

    return {
      empresas,
      totalItems: enrichedItems.length,
      totalCantidad: enrichedItems.reduce((sum, i) => sum + i.cantidad, 0),
      total: Math.round(enrichedItems.reduce((sum, i) => sum + i.subtotal, 0) * 100) / 100,
    };
  }

  /**
   * Agregar item al carrito (upsert: si ya existe, suma cantidad)
   */
  async agregarItem(usuarioId: string, dto: AgregarCarritoDto) {
    const { productoId, varianteId, cantidad = 1 } = dto;

    // Validar que el producto existe y es visible
    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: {
        id: true,
        empresaId: true,
        isActive: true,
        visibleMarketplace: true,
        tieneVariantes: true,
      },
    });

    if (!producto || !producto.isActive || !producto.visibleMarketplace) {
      throw new NotFoundException('Producto no encontrado o no disponible');
    }

    // Si tiene variantes, debe especificar una
    if (producto.tieneVariantes && !varianteId) {
      throw new BadRequestException('Este producto requiere seleccionar una variante');
    }

    // Validar variante si se proporcionó
    if (varianteId) {
      const variante = await this.prisma.productoVariante.findFirst({
        where: { id: varianteId, productoId, isActive: true },
      });
      if (!variante) {
        throw new NotFoundException('Variante no encontrada');
      }
    }

    // Verificar stock disponible
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        empresaId: producto.empresaId,
        productoId: varianteId ? null : productoId,
        varianteId: varianteId ?? null,
      },
    });

    if (!stock) {
      throw new BadRequestException('Producto sin stock disponible');
    }

    const disponible = this.calcularDisponible(stock);

    // Verificar item existente para calcular cantidad total
    const existente = await this.prisma.carritoItem.findFirst({
      where: {
        usuarioId,
        productoId,
        varianteId: varianteId ?? null,
      },
    });

    const cantidadTotal = (existente?.cantidad ?? 0) + cantidad;

    if (cantidadTotal > disponible) {
      throw new BadRequestException(
        `Stock insuficiente. Disponible: ${disponible}, solicitado: ${cantidadTotal}`,
      );
    }

    // Crear o actualizar cantidad
    if (existente) {
      await this.prisma.carritoItem.update({
        where: { id: existente.id },
        data: { cantidad: cantidadTotal },
      });
    } else {
      await this.prisma.carritoItem.create({
        data: {
          usuarioId,
          productoId,
          varianteId: varianteId ?? null,
          empresaId: producto.empresaId,
          cantidad,
        },
      });
    }

    return this.getCarrito(usuarioId);
  }

  /**
   * Actualizar cantidad de un item
   */
  async actualizarCantidad(usuarioId: string, itemId: string, cantidad: number) {
    const item = await this.prisma.carritoItem.findFirst({
      where: { id: itemId, usuarioId },
    });

    if (!item) {
      throw new NotFoundException('Item no encontrado en el carrito');
    }

    // Verificar stock
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        empresaId: item.empresaId,
        productoId: item.varianteId ? null : item.productoId,
        varianteId: item.varianteId ?? null,
      },
    });

    if (stock) {
      const disponible = this.calcularDisponible(stock);

      if (cantidad > disponible) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${disponible}`,
        );
      }
    }

    await this.prisma.carritoItem.update({
      where: { id: itemId },
      data: { cantidad },
    });

    return this.getCarrito(usuarioId);
  }

  /**
   * Eliminar un item del carrito
   */
  async eliminarItem(usuarioId: string, itemId: string) {
    const item = await this.prisma.carritoItem.findFirst({
      where: { id: itemId, usuarioId },
    });

    if (!item) {
      throw new NotFoundException('Item no encontrado en el carrito');
    }

    await this.prisma.carritoItem.delete({ where: { id: itemId } });

    return this.getCarrito(usuarioId);
  }

  /**
   * Vaciar todo el carrito
   */
  async vaciarCarrito(usuarioId: string) {
    await this.prisma.carritoItem.deleteMany({ where: { usuarioId } });
    return { empresas: [], totalItems: 0, totalCantidad: 0, total: 0 };
  }

  /**
   * Obtener cantidad total de items (para badge)
   */
  async getContador(usuarioId: string) {
    const result = await this.prisma.carritoItem.aggregate({
      where: { usuarioId },
      _sum: { cantidad: true },
      _count: true,
    });

    return {
      totalItems: result._count,
      totalCantidad: result._sum.cantidad ?? 0,
    };
  }

  /**
   * Obtener opciones de envío de una empresa
   */
  async getOpcionesEnvio(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        envioGratisDesde: true,
        permiteRetiroTienda: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Obtener sedes para retiro (solo si permite retiro en tienda)
    let sedesRetiro: any[] = [];
    if (empresa.permiteRetiroTienda) {
      sedesRetiro = await this.prisma.sede.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombre: true,
          direccion: true,
          distrito: true,
          provincia: true,
          coordenadas: true,
        },
      });
    }

    return {
      empresaId: empresa.id,
      empresaNombre: empresa.nombre,
      envio: {
        disponible: true,
        gratisDesde: empresa.envioGratisDesde ? Number(empresa.envioGratisDesde) : null,
        mensajeLocal: 'Costo de envío lo asume el cliente al recibir',
        mensajeNacional: 'Costo de envío lo asume el cliente al retirar de agencia',
      },
      retiroTienda: {
        disponible: empresa.permiteRetiroTienda,
        sedes: sedesRetiro,
      },
    };
  }
}
