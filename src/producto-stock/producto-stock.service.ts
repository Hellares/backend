import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearStockDto } from './dto/crear-stock.dto';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { ActualizarPreciosSedeDto } from './dto/actualizar-precios-sede.dto';
import { Prisma, TipoCambioPrecio } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';

// Usar Prisma.Decimal para los valores decimales
const Decimal = Prisma.Decimal;
type DecimalType = Prisma.Decimal;

@Injectable()
export class ProductoStockService {
  private readonly logger = new Logger(ProductoStockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene el stock de un producto/variante en una sede específica
   */
  async getStockPorSede(
    sedeId: string,
    productoId?: string,
    varianteId?: string,
  ) {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    return await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
          },
        },
      },
    });
  }

  /**
   * Crea un nuevo registro de stock para un producto/variante en una sede
   */
  async crearStock(
    empresaId: string,
    dto: CrearStockDto,
    usuarioId: string,
  ) {
    // Validar que se proporcione producto o variante (XOR)
    if (!dto.productoId && !dto.varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (dto.productoId && dto.varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    // Validar que el producto o variante esté activo
    if (dto.productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: dto.productoId, empresaId, isActive: true },
      });
      if (!producto) {
        throw new NotFoundException(
          'Producto no encontrado o inactivo',
        );
      }
    }

    if (dto.varianteId) {
      const variante = await this.prisma.productoVariante.findFirst({
        where: { id: dto.varianteId, isActive: true },
      });
      if (!variante) {
        throw new NotFoundException(
          'Variante no encontrada o inactiva',
        );
      }
    }

    // Verificar que la sede esté activa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId, isActive: true },
    });
    if (!sede) {
      throw new NotFoundException('Sede no encontrada o inactiva');
    }

    // Verificar que no exista ya un registro de stock
    const existente = await this.prisma.productoStock.findFirst({
      where: {
        sedeId: dto.sedeId,
        productoId: dto.productoId ?? null,
        varianteId: dto.varianteId ?? null,
      },
    });

    if (existente) {
      throw new BadRequestException(
        'Ya existe un registro de stock para este producto/variante en esta sede',
      );
    }

    // Crear stock y movimiento inicial en transacción
    return await this.prisma.$transaction(async (tx) => {
      // Crear registro de stock (incluyendo precios si se proporcionan)
      const stock = await tx.productoStock.create({
        data: {
          sedeId: dto.sedeId,
          empresaId,
          productoId: dto.productoId,
          varianteId: dto.varianteId,
          stockActual: dto.stockActual,
          stockMinimo: dto.stockMinimo,
          stockMaximo: dto.stockMaximo,
          ubicacion: dto.ubicacion,
          // Precios opcionales por sede
          precio: dto.precio ? new Decimal(dto.precio) : null,
          precioCosto: dto.precioCosto ? new Decimal(dto.precioCosto) : null,
          precioOferta: dto.precioOferta ? new Decimal(dto.precioOferta) : null,
          enOferta: dto.enOferta ?? false,
          fechaInicioOferta: dto.fechaInicioOferta
            ? new Date(dto.fechaInicioOferta)
            : null,
          fechaFinOferta: dto.fechaFinOferta
            ? new Date(dto.fechaFinOferta)
            : null,
          // Marcar como configurado si se proporciona precio
          precioConfigurado: !!dto.precio,
        },
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar movimiento inicial si hay stock
      if (dto.stockActual > 0) {
        await tx.movimientoStock.create({
          data: {
            sedeId: dto.sedeId,
            empresaId,
            productoStockId: stock.id,
            tipo: 'ENTRADA_AJUSTE',
            tipoDocumento: 'INICIAL',
            cantidadAnterior: 0,
            cantidad: dto.stockActual,
            cantidadNueva: dto.stockActual,
            motivo: 'Stock inicial',
            usuarioId,
          },
        });
      }

      return stock;
    });
  }

  /**
   * Ajusta el stock de un producto/variante en una sede
   * Registra el movimiento en el historial
   * Usa SELECT FOR UPDATE para prevenir race conditions en operaciones concurrentes
   */
  async ajustarStock(
    productoStockId: string,
    empresaId: string,
    dto: AjustarStockDto,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Bloquear la fila con FOR UPDATE para prevenir lecturas concurrentes
      const [stockLocked] = await tx.$queryRaw<
        Array<{ id: string; stockActual: number; sedeId: string; productoId: string | null; varianteId: string | null }>
      >`SELECT id, "stockActual", "sedeId", "productoId", "varianteId"
        FROM "ProductoStock"
        WHERE id = ${productoStockId}
        FOR UPDATE`;

      if (!stockLocked) {
        throw new NotFoundException('Stock no encontrado');
      }

      // Cargar relaciones para validaciones (ya bloqueada la fila de stock)
      const stock = await tx.productoStock.findUnique({
        where: { id: productoStockId },
        include: {
          producto: true,
          variante: true,
        },
      });

      // Validar que el producto o variante siga activo
      if (stock!.producto && !stock!.producto.isActive) {
        throw new BadRequestException(
          'No se puede ajustar stock de un producto inactivo',
        );
      }

      if (stock!.variante && !stock!.variante.isActive) {
        throw new BadRequestException(
          'No se puede ajustar stock de una variante inactiva',
        );
      }

      // Calcular nuevo stock usando el valor bloqueado (consistente)
      const stockAnterior = stockLocked.stockActual;
      const nuevoStock = stockAnterior + dto.cantidad;

      // Validar que no quede negativo
      if (nuevoStock < 0) {
        throw new BadRequestException(
          `Stock insuficiente. Actual: ${stockAnterior}, Requerido: ${Math.abs(dto.cantidad)}`,
        );
      }

      // Actualizar stock
      const stockActualizado = await tx.productoStock.update({
        where: { id: productoStockId },
        data: { stockActual: nuevoStock },
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar movimiento
      await tx.movimientoStock.create({
        data: {
          sedeId: stockLocked.sedeId,
          empresaId,
          productoStockId,
          tipo: dto.tipo,
          tipoDocumento: dto.tipoDocumento,
          numeroDocumento: dto.numeroDocumento,
          cantidadAnterior: stockAnterior,
          cantidad: dto.cantidad,
          cantidadNueva: nuevoStock,
          motivo: dto.motivo,
          observaciones: dto.observaciones,
          usuarioId,
        },
      });

      this.logger.log(
        `Stock ajustado: ${stock!.producto?.nombre || stock!.variante?.nombre} | Anterior: ${stockAnterior} | Cambio: ${dto.cantidad} | Nuevo: ${nuevoStock}`,
      );

      return stockActualizado;
    });
  }

  /**
   * Obtiene el stock de todos los productos en una sede
   */
  async getStocksPorSede(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          sedeId,
          empresaId,
        },
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              // precio: true, // ❌ DEPRECATED - Precio ahora solo en ProductoStock
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              // precio: true, // ❌ DEPRECATED - Precio ahora solo en ProductoStock
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
              isActive: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          sedeId,
          empresaId,
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene el historial de movimientos de un producto stock
   */
  async getHistorialMovimientos(
    productoStockId: string,
    limit: number = 50,
  ) {
    return await this.prisma.movimientoStock.findMany({
      where: { productoStockId },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    });
  }

  /**
   * Obtiene el stock de un producto/variante en todas las sedes
   */
  async getStockEnTodasSedes(
    empresaId: string,
    productoId?: string,
    varianteId?: string,
  ) {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
            isActive: true,
          },
        },
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
      },
      orderBy: {
        stockActual: 'desc',
      },
    });

    // Calcular total de stock
    const totalStock = stocks.reduce(
      (sum, stock) => sum + stock.stockActual,
      0,
    );

    return {
      stocks,
      resumen: {
        totalSedes: stocks.length,
        stockTotal: totalStock,
        sedesConStock: stocks.filter((s) => s.stockActual > 0).length,
        sedesSinStock: stocks.filter((s) => s.stockActual === 0).length,
      },
    };
  }

  /**
   * Obtiene productos con stock bajo el mínimo
   */
  async getProductosBajoMinimo(empresaId: string, sedeId?: string) {
    // Obtener IDs filtrados en DB (compara stockActual <= stockMinimo en PostgreSQL)
    const idsResult = await this.prisma.$queryRaw<Array<{ id: string; stockActual: number }>>`
      SELECT id, "stockActual"
      FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
        AND "stockMinimo" IS NOT NULL
        AND "stockActual" <= "stockMinimo"
        ${sedeId ? Prisma.sql`AND "sedeId" = ${sedeId}` : Prisma.empty}
      ORDER BY "stockActual" ASC
    `;

    if (idsResult.length === 0) {
      return { productos: [], total: 0, criticos: 0 };
    }

    const ids = idsResult.map((r) => r.id);

    // Cargar relaciones con Prisma usando los IDs ya filtrados
    const filtrados = await this.prisma.productoStock.findMany({
      where: { id: { in: ids } },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
          },
        },
      },
      orderBy: {
        stockActual: 'asc',
      },
    });

    return {
      productos: filtrados,
      total: filtrados.length,
      criticos: idsResult.filter((r) => r.stockActual === 0).length,
    };
  }

  // =====================================================
  // GESTIÓN DE PRECIOS POR SEDE
  // =====================================================

  /**
   * Actualiza los precios de un producto en una sede específica
   * Registra el cambio en el historial de precios por sede
   */
  async actualizarPreciosSede(
    productoStockId: string,
    empresaId: string,
    dto: ActualizarPreciosSedeDto,
    usuarioId: string,
  ) {
    // Obtener stock actual con precios
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: {
        producto: true,
        variante: true,
        sede: true,
      },
    });

    if (!stock) {
      throw new NotFoundException('Stock no encontrado');
    }

    if (stock.empresaId !== empresaId) {
      throw new BadRequestException(
        'El stock no pertenece a esta empresa',
      );
    }

    // Preparar datos de actualización
    const updateData: any = {};
    let hayActualizacion = false;

    if (dto.precio !== undefined) {
      updateData.precio = dto.precio ? new Decimal(dto.precio) : null;
      hayActualizacion = true;
    }

    if (dto.precioCosto !== undefined) {
      updateData.precioCosto = dto.precioCosto
        ? new Decimal(dto.precioCosto)
        : null;
      hayActualizacion = true;
    }

    if (dto.precioOferta !== undefined) {
      updateData.precioOferta = dto.precioOferta
        ? new Decimal(dto.precioOferta)
        : null;
      hayActualizacion = true;
    }

    if (dto.enOferta !== undefined) {
      updateData.enOferta = dto.enOferta;
      hayActualizacion = true;
    }

    if (dto.precioIncluyeIgv !== undefined) {
      updateData.precioIncluyeIgv = dto.precioIncluyeIgv;
      hayActualizacion = true;
    }

    if (dto.fechaInicioOferta !== undefined) {
      updateData.fechaInicioOferta = dto.fechaInicioOferta
        ? new Date(dto.fechaInicioOferta)
        : null;
      hayActualizacion = true;
    }

    if (dto.fechaFinOferta !== undefined) {
      updateData.fechaFinOferta = dto.fechaFinOferta
        ? new Date(dto.fechaFinOferta)
        : null;
      hayActualizacion = true;
    }

    if (!hayActualizacion) {
      throw new BadRequestException(
        'No se proporcionaron campos para actualizar',
      );
    }

    // Actualizar y registrar en historial en transacción
    return await this.prisma.$transaction(async (tx) => {
      // Si se está actualizando el precio, marcar como configurado
      if (dto.precio !== undefined && dto.precio !== null) {
        updateData.precioConfigurado = true;
      } else if (dto.precio === null) {
        // Si se está eliminando el precio, marcar como no configurado
        updateData.precioConfigurado = false;
      }

      // Actualizar precios
      const stockActualizado = await tx.productoStock.update({
        where: { id: productoStockId },
        data: updateData,
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar en historial si hubo cambios en precios
      const huboCambioPrecios =
        dto.precio !== undefined ||
        dto.precioCosto !== undefined ||
        dto.precioOferta !== undefined;

      if (huboCambioPrecios) {
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: stock.id,
            sedeId: stock.sedeId,
            precioAnterior: stock.precio
              ? new Decimal(stock.precio.toString())
              : null,
            precioNuevo:
              dto.precio !== undefined
                ? dto.precio
                  ? new Decimal(dto.precio)
                  : null
                : stock.precio
                  ? new Decimal(stock.precio.toString())
                  : null,
            precioCostoAnterior: stock.precioCosto
              ? new Decimal(stock.precioCosto.toString())
              : null,
            precioCostoNuevo:
              dto.precioCosto !== undefined
                ? dto.precioCosto
                  ? new Decimal(dto.precioCosto)
                  : null
                : stock.precioCosto
                  ? new Decimal(stock.precioCosto.toString())
                  : null,
            precioOfertaAnterior: stock.precioOferta
              ? new Decimal(stock.precioOferta.toString())
              : null,
            precioOfertaNuevo:
              dto.precioOferta !== undefined
                ? dto.precioOferta
                  ? new Decimal(dto.precioOferta)
                  : null
                : stock.precioOferta
                  ? new Decimal(stock.precioOferta.toString())
                  : null,
            tipoCambio: (dto.tipoCambio as TipoCambioPrecio) || TipoCambioPrecio.MANUAL,
            razon: dto.razon,
            origenModulo: 'INVENTARIO',
            usuarioId,
          },
        });
      }

      this.logger.log(
        `Precios actualizados para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre}`,
      );

      return stockActualizado;
    });
  }

  /**
   * Obtiene el precio de un producto en una sede (sin fallbacks)
   * Retorna el precio tal como está configurado en ProductoStock
   * Si no tiene precio configurado, retorna null
   */
  async obtenerPrecio(
    sedeId: string,
    productoId?: string,
    varianteId?: string,
  ): Promise<{
    precio: number | null;
    precioCosto: number | null;
    precioOferta: number | null;
    enOferta: boolean;
    ofertaActiva: boolean;
    precioConfigurado: boolean;
  } | null> {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    // Obtener stock con precios de sede
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
    });

    if (!stock) {
      return null;
    }

    // Verificar si la oferta está activa por fechas
    let ofertaActiva = false;
    if (stock.enOferta && stock.precioOferta) {
      const ahora = new Date();
      const inicioOferta = stock.fechaInicioOferta;
      const finOferta = stock.fechaFinOferta;

      if (inicioOferta && finOferta) {
        ofertaActiva = ahora >= inicioOferta && ahora <= finOferta;
      } else if (inicioOferta) {
        ofertaActiva = ahora >= inicioOferta;
      } else if (finOferta) {
        ofertaActiva = ahora <= finOferta;
      } else {
        ofertaActiva = true; // Si no hay fechas, la oferta está activa
      }
    }

    return {
      precio: stock.precio ? parseFloat(stock.precio.toString()) : null,
      precioCosto: stock.precioCosto
        ? parseFloat(stock.precioCosto.toString())
        : null,
      precioOferta: stock.precioOferta
        ? parseFloat(stock.precioOferta.toString())
        : null,
      enOferta: stock.enOferta,
      ofertaActiva,
      precioConfigurado: stock.precioConfigurado,
    };
  }

  /**
   * Valida si un producto está disponible para venta
   * Verifica: precio configurado, stock disponible, producto activo
   */
  async validarDisponibleParaVenta(
    sedeId: string,
    productoId: string,
    varianteId: string | null = null,
    cantidad: number = 1,
  ): Promise<{
    disponible: boolean;
    razones: string[];
  }> {
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        producto: true,
        variante: true,
      },
    });

    const razones: string[] = [];

    if (!stock) {
      razones.push('Producto no disponible en esta sede');
      return { disponible: false, razones };
    }

    // Validar precio configurado
    if (!stock.precioConfigurado || !stock.precio) {
      razones.push('Producto sin precio configurado');
    }

    // Validar stock suficiente
    if (stock.stockActual < cantidad) {
      razones.push(
        `Stock insuficiente (disponible: ${stock.stockActual}, requerido: ${cantidad})`,
      );
    }

    // Validar producto activo
    if (stock.producto && !stock.producto.isActive) {
      razones.push('Producto inactivo');
    }

    // Validar variante activa
    if (stock.variante && !stock.variante.isActive) {
      razones.push('Variante inactiva');
    }

    return {
      disponible: razones.length === 0,
      razones,
    };
  }

  /**
   * Obtiene productos pendientes de configuración de precio en una sede
   * Útil para dashboards y alertas
   */
  async getProductosPendientesPrecio(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: false,
          stockActual: { gt: 0 }, // Solo productos con stock
        },
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              isActive: true,
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
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: false,
          stockActual: { gt: 0 },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene productos listos para venta (precio configurado + stock disponible)
   * Filtra productos activos con precio y stock
   */
  async getProductosListosVenta(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              descripcion: true,
              visibleMarketplace: true,
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
            },
          },
        },
        orderBy: { actualizadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene productos para mostrar en marketplace
   * Filtra: precio configurado, stock disponible, visible en marketplace
   */
  async getProductosMarketplace(
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: {
            isActive: true,
            visibleMarketplace: true,
          },
        },
        include: {
          producto: {
            include: {
              // archivos: true, // ❌ Producto usa relación polimórfica con Archivo (entidadTipo/entidadId)
              empresaCategoria: true,
              empresaMarca: true,
            },
          },
          variante: {
            include: {
              archivos: true,
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
              direccion: true,
            },
          },
        },
        orderBy: [
          { producto: { destacado: 'desc' } },
          { producto: { ordenMarketplace: 'asc' } },
        ],
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: {
            isActive: true,
            visibleMarketplace: true,
          },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene estadísticas de configuración de precios
   * Útil para dashboards y métricas
   */
  async getEstadisticasPrecios(empresaId: string, sedeId?: string) {
    const where: Prisma.ProductoStockWhereInput = { empresaId };
    if (sedeId) {
      where.sedeId = sedeId;
    }

    const [
      total,
      conPrecio,
      sinPrecio,
      conStock,
      listosVenta,
      sinStock,
      inactivos,
    ] = await Promise.all([
      // Total de registros de stock
      this.prisma.productoStock.count({ where }),

      // Con precio configurado
      this.prisma.productoStock.count({
        where: { ...where, precioConfigurado: true },
      }),

      // Sin precio configurado
      this.prisma.productoStock.count({
        where: { ...where, precioConfigurado: false },
      }),

      // Con stock disponible
      this.prisma.productoStock.count({
        where: { ...where, stockActual: { gt: 0 } },
      }),

      // Listos para venta (precio + stock + activo)
      this.prisma.productoStock.count({
        where: {
          ...where,
          precioConfigurado: true,
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
      }),

      // Sin stock
      this.prisma.productoStock.count({
        where: { ...where, stockActual: 0 },
      }),

      // Inactivos
      this.prisma.productoStock.count({
        where: { ...where, producto: { isActive: false } },
      }),
    ]);

    // Productos pendientes (con stock pero sin precio)
    const pendientes = await this.prisma.productoStock.count({
      where: {
        ...where,
        precioConfigurado: false,
        stockActual: { gt: 0 },
      },
    });

    return {
      total,
      conPrecio,
      sinPrecio,
      conStock,
      sinStock,
      listosVenta,
      pendientes,
      inactivos,
      porcentajes: {
        precioConfigurado: total > 0 ? (conPrecio / total) * 100 : 0,
        listosVenta: total > 0 ? (listosVenta / total) * 100 : 0,
        pendientes: conStock > 0 ? (pendientes / conStock) * 100 : 0,
      },
    };
  }

  /**
   * Obtiene el historial de cambios de precio de un producto en una sede
   */
  async obtenerHistorialPreciosSede(
    productoStockId: string,
    limit: number = 50,
  ) {
    return await this.prisma.productoPrecioHistorialSede.findMany({
      where: { productoStockId },
      include: {
        usuario: {
          select: {
            id: true,
            email: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
              },
            },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    });
  }

  /**
   * Actualiza precios masivamente para todos los productos de una sede
   * Útil para ajustes de mercado o cambios de estrategia de precios
   */
  async actualizarPreciosMasivosPorSede(
    sedeId: string,
    empresaId: string,
    ajuste: {
      tipo: 'PORCENTAJE' | 'MONTO_FIJO';
      valor: number;
      aplicarA: 'PRECIO' | 'PRECIO_COSTO';
      operacion: 'AUMENTAR' | 'DISMINUIR';
      productoIds?: string[];
      excluirCombos?: boolean;
      soloCombos?: boolean;
    },
    usuarioId: string,
  ) {
    // Validar sede
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId, isActive: true },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada o inactiva');
    }

    // Construir filtro
    const where: Prisma.ProductoStockWhereInput = {
      sedeId,
      empresaId,
    };

    if (ajuste.productoIds && ajuste.productoIds.length > 0) {
      where.productoId = { in: ajuste.productoIds };
    }

    // Filtro de combos
    if (ajuste.excluirCombos) {
      where.producto = { esCombo: false };
    } else if (ajuste.soloCombos) {
      where.producto = { esCombo: true, tipoPrecioCombo: 'FIJO' };
      this.logger.log('Ajuste masivo solo para combos FIJO');
    }

    // Obtener todos los stocks afectados
    const stocks = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: true,
        variante: true,
      },
    });

    if (stocks.length === 0) {
      throw new BadRequestException(
        'No se encontraron productos para actualizar',
      );
    }

    this.logger.log(
      `Actualizando precios de ${stocks.length} productos en sede ${sede.nombre}`,
    );

    // Actualizar en transacción
    return await this.prisma.$transaction(async (tx) => {
      const actualizados = [];

      for (const stock of stocks) {
        // ✅ Obtener precio actual solo de ProductoStock (ya no hay fallback a variante/producto)
        let precioActual: DecimalType | null = null;
        let precioCostoActual: DecimalType | null = null;

        if (ajuste.aplicarA === 'PRECIO') {
          precioActual = stock.precio;
        } else {
          precioCostoActual = stock.precioCosto;
        }

        if (!precioActual && !precioCostoActual) {
          this.logger.warn(
            `ProductoStock ${stock.id} (${stock.producto?.nombre}) no tiene precio configurado, omitiendo`,
          );
          continue;
        }

        // Calcular nuevo precio
        let nuevoPrecio: DecimalType;
        let nuevoPrecioCosto: DecimalType | null = null;

        if (ajuste.aplicarA === 'PRECIO') {
          if (ajuste.tipo === 'PORCENTAJE') {
            const factor =
              ajuste.operacion === 'AUMENTAR'
                ? 1 + ajuste.valor / 100
                : 1 - ajuste.valor / 100;
            nuevoPrecio = new Decimal(
              parseFloat(precioActual.toString()) * factor,
            );
          } else {
            nuevoPrecio =
              ajuste.operacion === 'AUMENTAR'
                ? new Decimal(parseFloat(precioActual.toString()) + ajuste.valor)
                : new Decimal(parseFloat(precioActual.toString()) - ajuste.valor);
          }
        } else {
          if (precioCostoActual) {
            if (ajuste.tipo === 'PORCENTAJE') {
              const factor =
                ajuste.operacion === 'AUMENTAR'
                  ? 1 + ajuste.valor / 100
                  : 1 - ajuste.valor / 100;
              nuevoPrecioCosto = new Decimal(
                parseFloat(precioCostoActual.toString()) * factor,
              );
            } else {
              nuevoPrecioCosto =
                ajuste.operacion === 'AUMENTAR'
                  ? new Decimal(
                      parseFloat(precioCostoActual.toString()) + ajuste.valor,
                    )
                  : new Decimal(
                      parseFloat(precioCostoActual.toString()) - ajuste.valor,
                    );
            }
          }
        }

        // Actualizar stock
        const updateData: any = {};
        if (ajuste.aplicarA === 'PRECIO') {
          updateData.precio = nuevoPrecio;
          updateData.precioConfigurado = true; // Marcar como configurado
        } else {
          updateData.precioCosto = nuevoPrecioCosto;
        }

        const stockActualizado = await tx.productoStock.update({
          where: { id: stock.id },
          data: updateData,
        });

        // Registrar en historial
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: stock.id,
            sedeId: stock.sedeId,
            precioAnterior:
              ajuste.aplicarA === 'PRECIO'
                ? stock.precio || precioActual
                : null,
            precioNuevo: ajuste.aplicarA === 'PRECIO' ? nuevoPrecio : null,
            precioCostoAnterior:
              ajuste.aplicarA === 'PRECIO_COSTO'
                ? stock.precioCosto || precioCostoActual
                : null,
            precioCostoNuevo:
              ajuste.aplicarA === 'PRECIO_COSTO' ? nuevoPrecioCosto : null,
            tipoCambio: TipoCambioPrecio.MASIVO,
            razon: `Ajuste masivo: ${ajuste.operacion} ${ajuste.valor}${ajuste.tipo === 'PORCENTAJE' ? '%' : ' unidades'} en ${ajuste.aplicarA}`,
            origenModulo: 'INVENTARIO',
            usuarioId,
          },
        });

        actualizados.push(stockActualizado);
      }

      this.logger.log(
        `${actualizados.length} productos actualizados exitosamente`,
      );

      return {
        totalActualizados: actualizados.length,
        sede: {
          id: sede.id,
          nombre: sede.nombre,
        },
        ajuste,
      };
    });
  }
}
