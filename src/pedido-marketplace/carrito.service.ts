import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TipoPrecioNivel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgregarCarritoDto } from './dto/carrito.dto';

interface NivelLite {
  id: string;
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number | null;
  tipoPrecio: TipoPrecioNivel;
  precio: number | null;
  porcentajeDesc: number | null;
}

interface PrecioCalculado {
  precioUnitario: number;
  precioBase: number;
  precioOferta: number | null;
  precioLiquidacion: number | null;
  nivelAplicado: string | null;
  descuentoNivelPct: number | null;
  enLiquidacion: boolean;
}

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
   * Calcular precio efectivo aplicando:
   *   min(precioBase, precioOferta activa, precioLiquidacion activa, precio con nivel).
   *
   * Reglas:
   * - El nivel se aplica sobre `precioBase` (no sobre oferta/liquidación).
   * - Gana el menor sin acumular (mismo patrón que VentaService).
   * - Etiqueta: si nivel gana o empata → nombre del nivel. Si liquidación
   *   gana → 'Liquidación'. Si oferta gana → 'Oferta'. Si nada gana → null.
   */
  private aplicarNivel(
    niveles: NivelLite[],
    cantidad: number,
    precioBase: number,
    precioOfertaActiva: number | null,
    precioLiquidacionActiva: number | null,
  ): PrecioCalculado {
    // Buscar nivel aplicable más específico (mayor cantidadMinima ≤ cantidad)
    const aplicable = niveles
      .filter(
        (n) =>
          n.cantidadMinima <= cantidad &&
          (n.cantidadMaxima == null || n.cantidadMaxima >= cantidad),
      )
      .sort((a, b) => b.cantidadMinima - a.cantidadMinima)[0];

    let precioConNivel: number | null = null;
    let descuentoNivelPct: number | null = null;
    if (aplicable && precioBase > 0) {
      if (aplicable.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO && aplicable.precio != null) {
        precioConNivel = aplicable.precio;
        descuentoNivelPct =
          ((precioBase - precioConNivel) / precioBase) * 100;
      } else if (
        aplicable.tipoPrecio === TipoPrecioNivel.PORCENTAJE_DESCUENTO &&
        aplicable.porcentajeDesc != null
      ) {
        descuentoNivelPct = aplicable.porcentajeDesc;
        precioConNivel = precioBase * (1 - descuentoNivelPct / 100);
      }
    }

    // Comparar candidatos y elegir el menor
    const candidatos: Array<{ precio: number; tipo: 'base' | 'oferta' | 'nivel' | 'liquidacion' }> = [
      { precio: precioBase, tipo: 'base' },
    ];
    if (precioOfertaActiva != null) {
      candidatos.push({ precio: precioOfertaActiva, tipo: 'oferta' });
    }
    if (precioLiquidacionActiva != null) {
      candidatos.push({ precio: precioLiquidacionActiva, tipo: 'liquidacion' });
    }
    if (precioConNivel != null) {
      candidatos.push({ precio: precioConNivel, tipo: 'nivel' });
    }
    candidatos.sort((a, b) => a.precio - b.precio);
    const ganador = candidatos[0];

    // Etiqueta: nivel > liquidación > oferta. Empates priorizan nivel.
    let nivelAplicado: string | null = null;
    if (ganador.tipo === 'nivel') {
      nivelAplicado = aplicable!.nombre;
    } else if (
      precioConNivel != null &&
      Math.abs(precioConNivel - ganador.precio) < 0.001
    ) {
      nivelAplicado = aplicable!.nombre;
    } else if (ganador.tipo === 'liquidacion') {
      nivelAplicado = 'Liquidación';
    } else if (ganador.tipo === 'oferta') {
      nivelAplicado = 'Oferta';
    }

    return {
      precioUnitario: Math.round(ganador.precio * 100) / 100,
      precioBase,
      precioOferta: precioOfertaActiva,
      precioLiquidacion: precioLiquidacionActiva,
      enLiquidacion: ganador.tipo === 'liquidacion',
      nivelAplicado,
      descuentoNivelPct:
        descuentoNivelPct != null && ganador.tipo === 'nivel'
          ? Math.round(descuentoNivelPct * 100) / 100
          : null,
    };
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

    // Batch: obtener todos los stocks, imágenes y niveles de precio en 3 queries
    const productoIds = items.filter(i => !i.varianteId).map(i => i.productoId);
    const varianteIds = items.filter(i => i.varianteId).map(i => i.varianteId!);
    const allEntityIds = [...new Set([...productoIds, ...varianteIds])];

    const [allStocks, allImagenes, allNiveles] = await Promise.all([
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
          precioLiquidacion: true,
          enLiquidacion: true,
          fechaInicioLiquidacion: true,
          fechaFinLiquidacion: true,
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
      this.prisma.precioNivel.findMany({
        where: {
          isActive: true,
          OR: [
            ...(productoIds.length > 0 ? [{ productoId: { in: productoIds } }] : []),
            ...(varianteIds.length > 0 ? [{ varianteId: { in: varianteIds } }] : []),
          ],
        },
        select: {
          id: true,
          productoId: true,
          varianteId: true,
          nombre: true,
          cantidadMinima: true,
          cantidadMaxima: true,
          tipoPrecio: true,
          precio: true,
          porcentajeDesc: true,
        },
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

    // Lookup de niveles agrupados por productoId/varianteId
    const nivelesMap = new Map<string, NivelLite[]>();
    for (const n of allNiveles) {
      const key = n.varianteId ?? n.productoId;
      if (!key) continue;
      const lite: NivelLite = {
        id: n.id,
        nombre: n.nombre,
        cantidadMinima: n.cantidadMinima,
        cantidadMaxima: n.cantidadMaxima,
        tipoPrecio: n.tipoPrecio,
        precio: n.precio != null ? Number(n.precio) : null,
        porcentajeDesc: n.porcentajeDesc != null ? Number(n.porcentajeDesc) : null,
      };
      if (!nivelesMap.has(key)) nivelesMap.set(key, []);
      nivelesMap.get(key)!.push(lite);
    }

    // Enriquecer items sin queries adicionales
    const now = new Date();
    const enrichedItems = items.map((item) => {
      const lookupKey = item.varianteId ?? item.productoId;
      const stock = stockMap.get(lookupKey);
      const imagen = imageMap.get(lookupKey);
      const niveles = nivelesMap.get(lookupKey) ?? [];

      const ofertaActiva = stock?.enOferta
        && stock.precioOferta
        && (!stock.fechaInicioOferta || stock.fechaInicioOferta <= now)
        && (!stock.fechaFinOferta || stock.fechaFinOferta >= now);

      const liquidacionActiva = stock?.enLiquidacion
        && stock.precioLiquidacion
        && (!stock.fechaInicioLiquidacion || stock.fechaInicioLiquidacion <= now)
        && (!stock.fechaFinLiquidacion || stock.fechaFinLiquidacion >= now);

      const precioBase = stock?.precio ? Number(stock.precio) : 0;
      const precioOfertaActiva = ofertaActiva ? Number(stock.precioOferta) : null;
      const precioLiquidacionActiva = liquidacionActiva ? Number(stock.precioLiquidacion) : null;

      const calc = this.aplicarNivel(
        niveles,
        item.cantidad,
        precioBase,
        precioOfertaActiva,
        precioLiquidacionActiva,
      );

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
        precioUnitario: calc.precioUnitario,
        precioOferta: precioOfertaActiva,
        precioLiquidacion: precioLiquidacionActiva,
        enLiquidacion: calc.enLiquidacion,
        precioNormal: precioBase,
        precioBase,
        nivelAplicado: calc.nivelAplicado,
        descuentoNivelPct: calc.descuentoNivelPct,
        subtotal: Math.round(calc.precioUnitario * item.cantidad * 100) / 100,
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
