import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CrearStockDto } from './dto/crear-stock.dto';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { ActualizarPreciosSedeDto } from './dto/actualizar-precios-sede.dto';
import { QueryHistorialPreciosDto } from './dto/query-historial-precios.dto';
import { ActivarLiquidacionDto } from './dto/activar-liquidacion.dto';
import {
  CampoPrecio,
  ComparacionPrecio,
  FiltroStock,
  ModoVerificacion,
  VerificarPreciosDto,
} from './dto/verificar-precios.dto';
import { Prisma, TipoCambioPrecio } from '@prisma/client';
import { PromocionService } from '../promocion/promocion.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { createPaginatedResponse } from '../common/utils/pagination.util';

// Usar Prisma.Decimal para los valores decimales
const Decimal = Prisma.Decimal;
type DecimalType = Prisma.Decimal;

@Injectable()
export class ProductoStockService {
  private readonly logger = new Logger(ProductoStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly promocionService: PromocionService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
  ) {}

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
            esInsumo: true,
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
    const result = await this.prisma.$transaction(async (tx) => {
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
          precioIncluyeIgv: dto.precioIncluyeIgv ?? true,
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

    // Invalidar cache de productos después de crear stock
    await this.invalidateProductCache(empresaId);

    return result;
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
    const result = await this.prisma.$transaction(async (tx) => {
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

    // Invalidar cache de productos después de ajustar stock
    await this.invalidateProductCache(empresaId);

    // Notificar realtime: los cajeros con app abierta verán el nuevo
    // stock en sus cards en <3s sin pull-to-refresh manual.
    this.realtimeInvalidation.notifyStockCambiado({
      empresaId,
      productoId: result.productoId,
      varianteId: result.varianteId,
      sedeId: result.sedeId,
    });

    return result;
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
   * Kardex: historial de movimientos de stock para un producto
   */
  async getHistorialMovimientos(
    productoStockId: string,
    filtros?: {
      limit?: number;
      tipo?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    },
  ) {
    const limit = filtros?.limit ?? 100;

    const where: any = { productoStockId };

    if (filtros?.tipo) {
      where.tipo = filtros.tipo;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.creadoEn = {};
      if (filtros?.fechaDesde) {
        where.creadoEn.gte = new Date(filtros.fechaDesde);
      }
      if (filtros?.fechaHasta) {
        where.creadoEn.lte = new Date(filtros.fechaHasta);
      }
    }

    const movimientos = await this.prisma.movimientoStock.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: limit,
      include: {
        venta: { select: { id: true, codigo: true } },
        compra: { select: { id: true, codigo: true } },
        transferencia: { select: { id: true, codigo: true } },
        devolucion: { select: { id: true, codigo: true } },
      },
    });

    // Resumen agregado por tipo. Usa el MISMO `where` que la lista para
    // que el resumen respete tipo/fechaDesde/fechaHasta — antes era
    // global y descuadraba con lo visible cuando había filtros activos.
    const resumen = await this.prisma.movimientoStock.groupBy({
      by: ['tipo'],
      where,
      _sum: { cantidad: true },
      _count: { id: true },
    });

    return {
      movimientos,
      resumen: resumen.map((r) => ({
        tipo: r.tipo,
        totalCantidad: r._sum.cantidad ?? 0,
        totalMovimientos: r._count.id,
      })),
    };
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
            esInsumo: true,
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

    if (dto.ubicacion !== undefined) {
      updateData.ubicacion = dto.ubicacion || null;
      hayActualizacion = true;
    }

    if (dto.stockMinimo !== undefined) {
      updateData.stockMinimo = dto.stockMinimo;
      hayActualizacion = true;
    }

    if (dto.stockMaximo !== undefined) {
      updateData.stockMaximo = dto.stockMaximo;
      hayActualizacion = true;
    }

    if (!hayActualizacion) {
      throw new BadRequestException(
        'No se proporcionaron campos para actualizar',
      );
    }

    // Actualizar y registrar en historial en transacción
    const result = await this.prisma.$transaction(async (tx) => {
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

      // Registrar en historial SOLO si hubo cambio real de valor (no solo
      // si el DTO trae el campo). Antes se creaba un registro MANUAL
      // "sin diff de precios" cada vez que el frontend reenviaba los
      // mismos precios al guardar el dialog sin tocar nada.
      const cambio = (anterior: any, nuevo: any) => {
        if (nuevo === undefined) return false; // campo no enviado
        const ant = anterior != null ? Number(anterior.toString()) : null;
        const nvo = nuevo != null ? Number(nuevo) : null;
        if (ant == null && nvo == null) return false;
        if (ant == null || nvo == null) return true;
        return Math.abs(ant - nvo) > 0.001; // tolerancia centavo
      };
      const huboCambioPrecios =
        cambio(stock.precio, dto.precio) ||
        cambio(stock.precioCosto, dto.precioCosto) ||
        cambio(stock.precioOferta, dto.precioOferta);

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

      // Auto-trigger: notificar clientes cuando se activa una oferta
      if (dto.enOferta === true && !stock.enOferta && stock.producto) {
        this.promocionService
          .notificarOfertaAutomatica(empresaId, usuarioId, {
            id: stock.producto.id,
            nombre: stock.producto.nombre,
            precioOferta: dto.precioOferta ? Number(dto.precioOferta) : undefined,
          })
          .catch((err) =>
            this.logger.error(`Error en notificación automática de oferta: ${err.message}`),
          );
      }

      return stockActualizado;
    });

    // Invalidar cache de productos después de actualizar precios
    await this.invalidateProductCache(empresaId);

    // Notificar a clientes conectados vía FCM data-only para que invaliden
    // su cache local y refresquen el item. Defensa en capas: si FCM falla
    // o llega tarde, el 409 PRECIO_DESACTUALIZADO al cobrar sigue
    // protegiendo contra cobro a precio viejo.
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    return result;
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
    const result = await this.prisma.$transaction(async (tx) => {
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

    // Invalidar cache de productos después de actualizar precios masivamente
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Lista historial de precios con filtros avanzados y paginacion
   */
  async getHistorialPreciosGlobal(
    empresaId: string,
    query: QueryHistorialPreciosDto,
  ) {
    const limit = query.limit || 50;

    const where: any = {
      productoStock: { empresaId },
    };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipoCambio) where.tipoCambio = query.tipoCambio;

    if (query.productoId) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { productoId: query.productoId },
          { varianteId: query.productoId },
        ],
      };
    }

    if (query.search) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { producto: { nombre: { contains: query.search, mode: 'insensitive' } } },
          { variante: { nombre: { contains: query.search, mode: 'insensitive' } } },
          { producto: { codigoEmpresa: { contains: query.search, mode: 'insensitive' } } },
        ],
      };
    }

    if (query.fechaInicio || query.fechaFin) {
      where.creadoEn = {};
      if (query.fechaInicio) where.creadoEn.gte = new Date(query.fechaInicio);
      if (query.fechaFin) {
        const fin = new Date(query.fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.creadoEn.lte = fin;
      }
    }

    const findArgs: Prisma.ProductoPrecioHistorialSedeFindManyArgs = {
      where,
      include: {
        sede: { select: { id: true, nombre: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        productoStock: {
          select: {
            id: true,
            productoId: true,
            varianteId: true,
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    };

    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const data = await this.prisma.productoPrecioHistorialSede.findMany(findArgs);

    return {
      data,
      meta: {
        limit,
        hasNext: data.length === limit,
        nextCursor: data.length > 0 ? data[data.length - 1].id : null,
      },
    };
  }

  /**
   * Exportar historial de precios a Excel (streaming)
   */
  async exportHistorialPrecios(
    empresaId: string,
    query: QueryHistorialPreciosDto,
    res: Response,
  ) {
    const where: any = {
      productoStock: { empresaId },
    };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipoCambio) where.tipoCambio = query.tipoCambio;

    if (query.productoId) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { productoId: query.productoId },
          { varianteId: query.productoId },
        ],
      };
    }

    if (query.fechaInicio || query.fechaFin) {
      where.creadoEn = {};
      if (query.fechaInicio) where.creadoEn.gte = new Date(query.fechaInicio);
      if (query.fechaFin) {
        const fin = new Date(query.fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.creadoEn.lte = fin;
      }
    }

    // Validar rango maximo 3 meses
    if (query.fechaInicio && query.fechaFin) {
      const inicio = new Date(query.fechaInicio);
      const fin = new Date(query.fechaFin);
      const maxFin = new Date(inicio);
      maxFin.setMonth(maxFin.getMonth() + 3);
      if (fin > maxFin) {
        throw new BadRequestException('El rango maximo de exportacion es de 3 meses');
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Historial de Precios');
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Sede', key: 'sede', width: 20 },
      { header: 'Codigo', key: 'codigo', width: 15 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Variante', key: 'variante', width: 20 },
      { header: 'Tipo Cambio', key: 'tipoCambio', width: 16 },
      { header: 'Precio Anterior', key: 'precioAnterior', width: 16 },
      { header: 'Precio Nuevo', key: 'precioNuevo', width: 16 },
      { header: 'Costo Anterior', key: 'costoAnterior', width: 16 },
      { header: 'Costo Nuevo', key: 'costoNuevo', width: 16 },
      { header: 'Oferta Anterior', key: 'ofertaAnterior', width: 16 },
      { header: 'Oferta Nuevo', key: 'ofertaNuevo', width: 16 },
      { header: 'Razon', key: 'razon', width: 25 },
      { header: 'Origen', key: 'origen', width: 15 },
      { header: 'Usuario', key: 'usuario', width: 22 },
    ];

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      },
    };
    sheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    sheet.getRow(1).height = 25;

    const BATCH_SIZE = 2000;
    let cursor: string | undefined = undefined;

    while (true) {
      const batch = await this.prisma.productoPrecioHistorialSede.findMany({
        where,
        include: {
          sede: { select: { nombre: true } },
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
          productoStock: {
            select: {
              producto: { select: { nombre: true, codigoEmpresa: true } },
              variante: { select: { nombre: true, sku: true } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const h of batch) {
        const usuarioNombre = h.usuario?.persona
          ? `${h.usuario.persona.nombres} ${h.usuario.persona.apellidos}`
          : '';

        sheet.addRow({
          fecha: h.creadoEn.toISOString().replace('T', ' ').substring(0, 19),
          sede: h.sede?.nombre ?? '',
          codigo: h.productoStock?.producto?.codigoEmpresa ?? '',
          producto: h.productoStock?.producto?.nombre ?? '',
          variante: h.productoStock?.variante
            ? `${h.productoStock.variante.nombre}${h.productoStock.variante.sku ? ` (${h.productoStock.variante.sku})` : ''}`
            : '',
          tipoCambio: h.tipoCambio,
          precioAnterior: h.precioAnterior ? Number(h.precioAnterior) : '',
          precioNuevo: h.precioNuevo ? Number(h.precioNuevo) : '',
          costoAnterior: h.precioCostoAnterior ? Number(h.precioCostoAnterior) : '',
          costoNuevo: h.precioCostoNuevo ? Number(h.precioCostoNuevo) : '',
          ofertaAnterior: h.precioOfertaAnterior ? Number(h.precioOfertaAnterior) : '',
          ofertaNuevo: h.precioOfertaNuevo ? Number(h.precioOfertaNuevo) : '',
          razon: h.razon ?? '',
          origen: h.origenModulo ?? '',
          usuario: usuarioNombre,
        });
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    for (const col of [7, 8, 9, 10, 11, 12]) {
      sheet.getColumn(col).numFmt = '#,##0.00';
    }

    const fechaLabel = query.fechaInicio && query.fechaFin
      ? `${query.fechaInicio}_${query.fechaFin}`
      : new Date().toISOString().split('T')[0];

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=historial_precios_${fechaLabel}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Cron: Desactivar ofertas expiradas (cada hora)
   */
  @Cron('0 * * * *')
  async desactivarOfertasExpiradas() {
    try {
      const ahora = new Date();
      const result = await this.prisma.productoStock.updateMany({
        where: {
          enOferta: true,
          fechaFinOferta: { not: null, lt: ahora },
        },
        data: { enOferta: false },
      });

      if (result.count > 0) {
        this.logger.log(`[Ofertas] ${result.count} ofertas expiradas desactivadas`);
      }
    } catch (error: any) {
      this.logger.error(`[Ofertas] Error desactivando ofertas: ${error.message}`);
    }
  }

  /**
   * Obtener ubicaciones distintas de una sede
   */
  async getUbicaciones(empresaId: string, sedeId: string) {
    const result = await this.prisma.$queryRaw<Array<{ ubicacion: string }>>`
      SELECT DISTINCT "ubicacion"
      FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
      AND "sedeId" = ${sedeId}
      AND "ubicacion" IS NOT NULL
      AND "ubicacion" != ''
      ORDER BY "ubicacion"
    `;
    return result.map((r) => r.ubicacion);
  }

  /**
   * Obtener stock filtrado por ubicación
   */
  async getStockPorUbicacion(empresaId: string, sedeId: string, ubicacion: string) {
    return this.prisma.productoStock.findMany({
      where: { empresaId, sedeId, ubicacion },
      include: {
        producto: { select: { id: true, nombre: true, codigoEmpresa: true, codigoBarras: true } },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
      orderBy: { producto: { nombre: 'asc' } },
    });
  }

  /**
   * Exportar Kardex a Excel
   */
  async exportKardex(
    productoStockId: string,
    filtros: { tipo?: string; fechaDesde?: string; fechaHasta?: string },
    res: any,
  ) {
    const data = await this.getHistorialMovimientos(productoStockId, {
      limit: 10000,
      ...filtros,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Kardex');

    // Header style
    const headerStyle: {
      font: Partial<ExcelJS.Font>;
      fill: ExcelJS.FillPattern;
      alignment: Partial<ExcelJS.Alignment>;
    } = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
      alignment: { horizontal: 'center' },
    };

    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Tipo Movimiento', key: 'tipo', width: 30 },
      { header: 'Documento', key: 'documento', width: 20 },
      { header: 'Cant. Anterior', key: 'anterior', width: 15 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Cant. Nueva', key: 'nueva', width: 15 },
      { header: 'Motivo', key: 'motivo', width: 30 },
    ];

    // Apply header style
    sheet.getRow(1).eachCell((cell) => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.alignment = headerStyle.alignment;
    });

    for (const mov of data.movimientos) {
      const doc = mov.venta?.codigo || mov.compra?.codigo || mov.transferencia?.codigo || mov.devolucion?.codigo || mov.numeroDocumento || '';
      sheet.addRow({
        fecha: mov.creadoEn ? new Date(mov.creadoEn).toLocaleString('es-PE') : '',
        tipo: mov.tipo.replace(/_/g, ' '),
        documento: doc,
        anterior: mov.cantidadAnterior,
        cantidad: mov.cantidad,
        nueva: mov.cantidadNueva,
        motivo: mov.motivo || '',
      });
    }

    // Resumen sheet
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Tipo Movimiento', key: 'tipo', width: 30 },
      { header: 'Total Cantidad', key: 'totalCantidad', width: 15 },
      { header: 'Total Movimientos', key: 'totalMovimientos', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.alignment = headerStyle.alignment;
    });

    for (const r of data.resumen) {
      resumenSheet.addRow({
        tipo: r.tipo.replace(/_/g, ' '),
        totalCantidad: r.totalCantidad,
        totalMovimientos: r.totalMovimientos,
      });
    }

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=kardex_${productoStockId}.xlsx`,
    });

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Actualizar stock minimo/maximo en bulk
   */
  async actualizarStockMinMaxBulk(
    empresaId: string,
    sedeId: string,
    items: Array<{ productoStockId: string; stockMinimo?: number; stockMaximo?: number }>,
  ) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.productoStock.update({
          where: { id: item.productoStockId },
          data: {
            ...(item.stockMinimo !== undefined && { stockMinimo: item.stockMinimo }),
            ...(item.stockMaximo !== undefined && { stockMaximo: item.stockMaximo }),
          },
        }),
      ),
    );
  }

  /**
   * Resumen de mermas y perdidas
   */
  async getResumenMermas(
    empresaId: string,
    sedeId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const where: any = {
      empresaId,
      tipo: { in: ['AJUSTE_MERMA', 'AJUSTE_PERDIDA', 'SALIDA_BAJA', 'SALIDA_DONACION', 'SALIDA_ROBO'] },
    };

    if (sedeId) where.sedeId = sedeId;
    if (fechaDesde) where.creadoEn = { ...where.creadoEn, gte: new Date(fechaDesde) };
    if (fechaHasta) where.creadoEn = { ...where.creadoEn, lte: new Date(fechaHasta) };

    const resumen = await this.prisma.movimientoStock.groupBy({
      by: ['tipo'],
      where,
      _sum: { cantidad: true },
      _count: { id: true },
    });

    const movimientos = await this.prisma.movimientoStock.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: 50,
      include: {
        productoStock: {
          select: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
          },
        },
      },
    });

    return {
      resumen: resumen.map((r) => ({
        tipo: r.tipo,
        totalCantidad: Math.abs(Number(r._sum.cantidad ?? 0)),
        totalMovimientos: r._count.id,
      })),
      movimientos,
    };
  }

  /**
   * Valorizacion del inventario
   */
  async getValorizacionInventario(empresaId: string, sedeId?: string) {
    const whereBase = sedeId ? `AND ps."sedeId" = '${sedeId}'` : '';

    // By sede
    const porSede = await this.prisma.$queryRaw<Array<{
      sedeId: string;
      sedeNombre: string;
      valorTotal: number;
      stockTotal: number;
      totalProductos: number;
    }>>`
      SELECT ps."sedeId", s.nombre as "sedeNombre",
             COALESCE(SUM(ps."stockActual" * COALESCE(ps."precioCosto", 0)), 0)::float as "valorTotal",
             COALESCE(SUM(ps."stockActual"), 0)::int as "stockTotal",
             COUNT(*)::int as "totalProductos"
      FROM "ProductoStock" ps
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      GROUP BY ps."sedeId", s.nombre
      ORDER BY "valorTotal" DESC
    `;

    // Top 10 most valuable
    const topProductos = await this.prisma.$queryRaw<Array<{
      productoNombre: string;
      codigoProducto: string;
      stockActual: number;
      precioCosto: number;
      valorTotal: number;
      sedeNombre: string;
    }>>`
      SELECT p.nombre as "productoNombre", p."codigoEmpresa" as "codigoProducto",
             ps."stockActual"::int, COALESCE(ps."precioCosto", 0)::float as "precioCosto",
             (ps."stockActual" * COALESCE(ps."precioCosto", 0))::float as "valorTotal",
             s.nombre as "sedeNombre"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      AND ps."precioCosto" > 0
      ORDER BY "valorTotal" DESC
      LIMIT 10
    `;

    const valorGlobal = porSede.reduce((sum, s) => sum + (s.valorTotal || 0), 0);
    const stockGlobal = porSede.reduce((sum, s) => sum + (s.stockTotal || 0), 0);

    return {
      valorGlobal: Math.round(valorGlobal * 100) / 100,
      stockGlobal,
      totalSedes: porSede.length,
      porSede,
      topProductos,
    };
  }

  /**
   * Sugerencias de reorden (productos bajo stock minimo)
   */
  async getSugerenciasReorden(empresaId: string, sedeId?: string) {
    const where: any = {
      empresaId,
      stockMinimo: { not: null },
    };
    if (sedeId) where.sedeId = sedeId;

    const productos = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });

    // Filter only those below minimum
    const bajosMinimo = productos.filter((ps) => ps.stockActual <= (ps.stockMinimo ?? 0));

    return bajosMinimo.map((ps) => {
      const stockMinimo = ps.stockMinimo ?? 0;
      const stockMaximo = ps.stockMaximo ?? stockMinimo * 2;
      const cantidadSugerida = Math.max(stockMaximo - ps.stockActual, 0);

      return {
        productoStockId: ps.id,
        productoId: ps.productoId,
        varianteId: ps.varianteId,
        productoNombre: ps.producto?.nombre ?? ps.variante?.nombre ?? 'Producto',
        codigoProducto: ps.producto?.codigoEmpresa ?? ps.variante?.sku ?? '',
        sedeNombre: ps.sede?.nombre ?? '',
        stockActual: ps.stockActual,
        stockMinimo,
        stockMaximo,
        cantidadSugerida,
        precioCosto: ps.precioCosto ? Number(ps.precioCosto) : null,
        valorEstimado: cantidadSugerida * (ps.precioCosto ? Number(ps.precioCosto) : 0),
      };
    }).sort((a, b) => {
      // Most urgent first (lowest stock relative to minimum)
      const urgA = a.stockActual / (a.stockMinimo || 1);
      const urgB = b.stockActual / (b.stockMinimo || 1);
      return urgA - urgB;
    });
  }

  /**
   * Reporte de rotacion de productos
   */
  async getReporteRotacion(empresaId: string, sedeId?: string, dias: number = 90) {
    const fechaDesde = new Date();
    fechaDesde.setDate(fechaDesde.getDate() - dias);

    const whereBase = sedeId ? `AND ps."sedeId" = '${sedeId}'` : '';

    const result = await this.prisma.$queryRaw<Array<{
      productoStockId: string;
      productoNombre: string;
      codigoProducto: string;
      sedeNombre: string;
      stockActual: number;
      unidadesVendidas: number;
      totalMovimientos: number;
    }>>`
      SELECT ps.id as "productoStockId",
             p.nombre as "productoNombre",
             p."codigoEmpresa" as "codigoProducto",
             s.nombre as "sedeNombre",
             ps."stockActual"::int,
             COALESCE(ventas."unidadesVendidas", 0)::int as "unidadesVendidas",
             COALESCE(ventas."totalMovimientos", 0)::int as "totalMovimientos"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      LEFT JOIN (
        SELECT ms."productoStockId",
               SUM(ABS(ms.cantidad))::int as "unidadesVendidas",
               COUNT(*)::int as "totalMovimientos"
        FROM "MovimientoStock" ms
        WHERE ms.tipo = 'SALIDA_VENTA'
        AND ms."creadoEn" >= ${fechaDesde}
        GROUP BY ms."productoStockId"
      ) ventas ON ventas."productoStockId" = ps.id
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      ORDER BY "unidadesVendidas" DESC
    `;

    // Classify
    const total = result.length;
    const altaRotacion = result.filter((r) => r.unidadesVendidas >= 50);
    const mediaRotacion = result.filter((r) => r.unidadesVendidas >= 10 && r.unidadesVendidas < 50);
    const bajaRotacion = result.filter((r) => r.unidadesVendidas >= 1 && r.unidadesVendidas < 10);
    const sinMovimiento = result.filter((r) => r.unidadesVendidas === 0);

    return {
      periodo: dias,
      totalProductos: total,
      resumen: {
        altaRotacion: altaRotacion.length,
        mediaRotacion: mediaRotacion.length,
        bajaRotacion: bajaRotacion.length,
        sinMovimiento: sinMovimiento.length,
      },
      productos: result.map((r) => ({
        ...r,
        clasificacion: r.unidadesVendidas >= 50 ? 'ALTA'
          : r.unidadesVendidas >= 10 ? 'MEDIA'
          : r.unidadesVendidas >= 1 ? 'BAJA'
          : 'SIN_MOVIMIENTO',
      })),
    };
  }

  /**
   * Invalidar cache de productos y estadísticas de la empresa
   */
  private async invalidateProductCache(empresaId: string): Promise<void> {
    try {
      const statsKey = this.cacheService.getEmpresaStatsKey(empresaId);
      await this.cacheService.invalidate(statsKey);
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache: ${errorMessage}`);
    }
  }

  // =====================================================
  // MONITOR DE PRODUCTOS
  // =====================================================

  /**
   * Monitor completo del estado de productos: estadísticas y alertas
   */
  async getMonitorProductos(empresaId: string, sedeId?: string) {
    const baseWhere: any = { empresaId };
    if (sedeId) baseWhere.sedeId = sedeId;

    // 1. Conteos paralelos de ProductoStock
    const [
      totalProductoStock,
      conStock,
      sinStock,
      conPrecio,
      sinPrecio,
      conPrecioCosto,
      sinPrecioCosto,
      conUbicacion,
      sinUbicacion,
      precioIncluyeIgv,
      precioNoIncluyeIgv,
      enOferta,
    ] = await Promise.all([
      this.prisma.productoStock.count({ where: baseWhere }),
      this.prisma.productoStock.count({ where: { ...baseWhere, stockActual: { gt: 0 } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, stockActual: { lte: 0 } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioConfigurado: true } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioConfigurado: false } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioCosto: { not: null } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, OR: [{ precioCosto: null }, { precioCosto: 0 }] } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, ubicacion: { not: null }, NOT: { ubicacion: '' } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, OR: [{ ubicacion: null }, { ubicacion: '' }] } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioIncluyeIgv: true } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioIncluyeIgv: false } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, enOferta: true } }),
    ]);

    // Bajo mínimo: raw SQL porque Prisma no puede comparar dos columnas
    const bajoMinimoResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND "sedeId" = ${sedeId}` : Prisma.empty}
      AND "stockMinimo" IS NOT NULL
      AND "stockActual" <= "stockMinimo"
    `;
    const bajoMinimo = Number(bajoMinimoResult[0]?.count ?? 0);

    // 2. Conteos de Producto (no stock) para marketplace e imágenes
    const productoBaseWhere: any = { empresaId, isActive: true, deletedAt: null };

    const [totalProductos, visibleMarketplace, noVisibleMarketplace, conBarcode] = await Promise.all([
      this.prisma.producto.count({ where: productoBaseWhere }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, visibleMarketplace: true } }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, visibleMarketplace: false } }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, codigoBarras: { not: null }, NOT: { codigoBarras: '' } } }),
    ]);
    const sinBarcode = totalProductos - conBarcode;

    // Productos con imagen (raw SQL por relación polimórfica)
    const conImagenResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT p.id)::int as count
      FROM "Producto" p
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Archivo" a
        WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true
      )
    `;
    const conImagen = Number(conImagenResult[0]?.count ?? 0);
    const sinImagen = totalProductos - conImagen;

    // 3. Métricas compuestas
    const listosParaVenta = await this.prisma.productoStock.count({
      where: { ...baseWhere, precioConfigurado: true, stockActual: { gt: 0 } },
    });

    // % catálogo completo = tiene precio + stock > 0 + ubicación + imagen / total
    const catalogoCompletoResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ps.id)::int as count
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      WHERE ps."empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      AND ps."precioConfigurado" = true
      AND ps."stockActual" > 0
      AND ps."ubicacion" IS NOT NULL AND ps."ubicacion" != ''
      AND EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
    `;
    const catalogoCompleto = Number(catalogoCompletoResult[0]?.count ?? 0);
    const porcentajeCatalogoCompleto = totalProductoStock > 0
      ? Math.round((catalogoCompleto / totalProductoStock) * 10000) / 100
      : 0;

    // 4. Listas de alertas (max 20 cada una)
    const includeProducto = {
      producto: { select: { id: true, nombre: true, codigoEmpresa: true, visibleMarketplace: true } },
      variante: { select: { id: true, nombre: true } },
      sede: { select: { id: true, nombre: true } },
    };

    const mapAlerta = (ps: any) => ({
      id: ps.id,
      productoId: ps.producto?.id ?? ps.productoId,
      nombre: ps.variante ? `${ps.producto?.nombre} - ${ps.variante.nombre}` : ps.producto?.nombre,
      codigoEmpresa: ps.producto?.codigoEmpresa,
      sedeNombre: ps.sede?.nombre,
      stockActual: ps.stockActual,
      precio: ps.precio ? Number(ps.precio) : null,
      ubicacion: ps.ubicacion,
    });

    const [alertaSinPrecio, alertaSinCosto, alertaSinUbicacion, alertaStockCero, alertaPrecioSinIgv] = await Promise.all([
      this.prisma.productoStock.findMany({ where: { ...baseWhere, precioConfigurado: false }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, OR: [{ precioCosto: null }] }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, OR: [{ ubicacion: null }, { ubicacion: '' }] }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, stockActual: { lte: 0 } }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, precioConfigurado: true, precioIncluyeIgv: false }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
    ]);

    // Alertas bajo mínimo (raw SQL)
    const alertaBajoMinimo = await this.prisma.$queryRaw<any[]>`
      SELECT ps.id, ps."productoId", ps."stockActual", ps.precio::float, ps.ubicacion,
             p.nombre, p."codigoEmpresa", s.nombre as "sedeNombre"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      AND ps."stockMinimo" IS NOT NULL
      AND ps."stockActual" <= ps."stockMinimo"
      LIMIT 20
    `;

    // Alertas sin imagen y marketplace sin imagen (con datos de stock)
    const alertaSinImagen = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
      LIMIT 20
    `;

    const alertaSinBarcode = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND (p."codigoBarras" IS NULL OR p."codigoBarras" = '')
      LIMIT 20
    `;

    const alertaMarketplaceSinImagen = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND p."visibleMarketplace" = true
      AND NOT EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
      LIMIT 20
    `;

    // 5. Respuesta completa
    return {
      estadisticas: {
        totalProductos,
        productosActivos: totalProductos,
        totalProductoStock,
        conStock,
        sinStock,
        bajoMinimo,
        conPrecio,
        sinPrecio,
        conPrecioCosto,
        sinPrecioCosto,
        conUbicacion,
        sinUbicacion,
        visibleMarketplace,
        noVisibleMarketplace,
        precioIncluyeIgv,
        precioNoIncluyeIgv,
        enOferta,
        conImagen,
        sinImagen,
        conBarcode,
        sinBarcode,
        porcentajeCatalogoCompleto,
        listosParaVenta,
      },
      alertas: {
        sinPrecio: alertaSinPrecio,
        sinPrecioCosto: alertaSinCosto,
        sinUbicacion: alertaSinUbicacion,
        sinImagen: alertaSinImagen,
        stockCero: alertaStockCero,
        bajoMinimo: alertaBajoMinimo,
        marketplaceSinImagen: alertaMarketplaceSinImagen,
        precioSinIgv: alertaPrecioSinIgv,
        sinBarcode: alertaSinBarcode,
      },
    };
  }

  // =====================================================
  // BULK OPERATIONS (Monitor de Productos)
  // =====================================================

  /**
   * Listar productos con estado marketplace
   */
  async getProductosMarketplaceEstado(empresaId: string) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, isActive: true, deletedAt: null },
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        visibleMarketplace: true,
        stocksPorSede: {
          select: { stockActual: true, precio: true },
          take: 1,
        },
      },
      orderBy: [{ visibleMarketplace: 'desc' }, { nombre: 'asc' }],
    });

    return productos.map(p => ({
      id: p.id,
      nombre: p.nombre,
      codigoEmpresa: p.codigoEmpresa,
      visibleMarketplace: p.visibleMarketplace,
      stockActual: p.stocksPorSede[0]?.stockActual ?? 0,
      precio: p.stocksPorSede[0]?.precio ? Number(p.stocksPorSede[0].precio) : null,
    }));
  }

  /**
   * Bulk activar/desactivar marketplace para productos
   */
  async bulkMarketplace(empresaId: string, productoIds: string[], visible: boolean) {
    const result = await this.prisma.producto.updateMany({
      where: { id: { in: productoIds }, empresaId },
      data: { visibleMarketplace: visible },
    });
    return { updated: result.count };
  }

  /**
   * Bulk asignar ubicación a registros de stock
   */
  async bulkUbicacion(empresaId: string, productoStockIds: string[], ubicacion: string) {
    const result = await this.prisma.productoStock.updateMany({
      where: { id: { in: productoStockIds }, empresaId },
      data: { ubicacion },
    });
    return { updated: result.count };
  }

  /**
   * Bulk marcar precio incluye IGV
   */
  async bulkPrecioIgv(empresaId: string, productoStockIds: string[], precioIncluyeIgv: boolean) {
    const result = await this.prisma.productoStock.updateMany({
      where: { id: { in: productoStockIds }, empresaId },
      data: { precioIncluyeIgv },
    });
    return { updated: result.count };
  }

  // =====================================================
  // LIQUIDACIÓN — remate por debajo de precio costo
  // =====================================================

  /**
   * Valida que el usuario tenga rol de GERENTE_SEDE/ADMINISTRADOR (a nivel
   * sede) o SUPER_ADMIN/EMPRESA_ADMIN (a nivel empresa) — usado para
   * autorizar la activación de liquidación o la venta bajo costo. El flujo
   * normal es que el front llame primero a /auth/autorizar-operacion para
   * validar DNI+password, este método sirve como defensa extra.
   */
  private async assertAutorizadorGerencial(autorizadoPorId: string, empresaId: string): Promise<void> {
    const empresaRol = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: autorizadoPorId,
        empresaId,
        isActive: true,
        deletedAt: null,
        rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
      },
    });
    if (empresaRol) return;

    const sedeRol = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: autorizadoPorId,
        sede: { empresaId },
        rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR'] },
        isActive: true,
      },
    });
    if (sedeRol) return;

    throw new BadRequestException(
      'El autorizador no tiene rol de GERENTE_SEDE/ADMINISTRADOR',
    );
  }

  async activarLiquidacion(
    productoStockId: string,
    empresaId: string,
    dto: ActivarLiquidacionDto,
    usuarioId: string,
  ) {
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: { producto: true, variante: true, sede: true },
    });
    if (!stock) throw new NotFoundException('Stock no encontrado');
    if (stock.empresaId !== empresaId) {
      throw new BadRequestException('El stock no pertenece a esta empresa');
    }
    // Lock conceptual: no permitir reactivar si ya está activa. Evita
    // race entre dos admins simultáneos que pisaría el precioLiquidacion
    // / motivo del primero sin warning. Para cambiar precio/motivo el
    // admin debe desactivar primero y volver a activar.
    if (stock.enLiquidacion) {
      throw new BadRequestException(
        'El producto ya está en liquidación. Desactívala primero si necesitás cambiar el precio o motivo.',
      );
    }
    if (!stock.precioCosto || Number(stock.precioCosto) <= 0) {
      throw new BadRequestException(
        'El producto no tiene precio de costo configurado. Configúralo antes de liquidar.',
      );
    }
    if (dto.precioLiquidacion >= Number(stock.precioCosto)) {
      throw new BadRequestException(
        'El precio de liquidación debe ser menor al precio de costo (S/' +
          Number(stock.precioCosto).toFixed(2) +
          '). Si el precio es mayor al costo, usa una oferta normal.',
      );
    }
    if (dto.motivoLiquidacion === 'OTRO' && !dto.observaciones?.trim()) {
      throw new BadRequestException(
        'Cuando el motivo es OTRO, las observaciones son obligatorias',
      );
    }

    await this.assertAutorizadorGerencial(dto.autorizadoPorId, empresaId);

    const fechaInicio = new Date();
    const fechaFin = dto.fechaFin ? new Date(dto.fechaFin) : null;
    if (fechaFin && fechaFin <= fechaInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a hoy');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Check atomico contra race: updateMany con where enLiquidacion=false
      // garantiza que solo gana la primera transaccion. La segunda admin
      // que llegue obtiene count=0 y tiramos error claro.
      const lock = await tx.productoStock.updateMany({
        where: { id: productoStockId, enLiquidacion: false },
        data: {
          enLiquidacion: true,
          precioLiquidacion: new Decimal(dto.precioLiquidacion),
          motivoLiquidacion: dto.motivoLiquidacion,
          observacionesLiquidacion: dto.observaciones ?? null,
          fechaInicioLiquidacion: fechaInicio,
          fechaFinLiquidacion: fechaFin,
          liquidacionAutorizadaPorId: dto.autorizadoPorId,
        },
      });
      if (lock.count === 0) {
        throw new BadRequestException(
          'Otro usuario activó la liquidación de este producto simultáneamente. Refrescá y revisá el estado actual.',
        );
      }
      const result = await tx.productoStock.findUniqueOrThrow({
        where: { id: productoStockId },
        include: { producto: true, variante: true, sede: true },
      });

      await tx.productoPrecioHistorialSede.create({
        data: {
          productoStockId: stock.id,
          sedeId: stock.sedeId,
          precioAnterior: stock.precio,
          precioNuevo: stock.precio,
          precioCostoAnterior: stock.precioCosto,
          precioCostoNuevo: stock.precioCosto,
          precioOfertaAnterior: stock.precioOferta,
          precioOfertaNuevo: new Decimal(dto.precioLiquidacion),
          tipoCambio: TipoCambioPrecio.LIQUIDACION,
          razon:
            `Liquidación activada [${dto.motivoLiquidacion}]` +
            (dto.observaciones ? `: ${dto.observaciones}` : ''),
          origenModulo: 'LIQUIDACION',
          usuarioId,
        },
      });

      return result;
    });

    await this.invalidateProductCache(empresaId);
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    this.logger.log(
      `Liquidación activada para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre} (motivo: ${dto.motivoLiquidacion}, precio: S/${dto.precioLiquidacion})`,
    );

    return updated;
  }

  async desactivarLiquidacion(
    productoStockId: string,
    empresaId: string,
    usuarioId: string,
    razon?: string,
  ) {
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: { producto: true, variante: true, sede: true },
    });
    if (!stock) throw new NotFoundException('Stock no encontrado');
    if (stock.empresaId !== empresaId) {
      throw new BadRequestException('El stock no pertenece a esta empresa');
    }
    if (!stock.enLiquidacion) {
      throw new BadRequestException('El producto no está en liquidación');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productoStock.update({
        where: { id: productoStockId },
        data: {
          enLiquidacion: false,
          precioLiquidacion: null,
          motivoLiquidacion: null,
          observacionesLiquidacion: null,
          fechaInicioLiquidacion: null,
          fechaFinLiquidacion: null,
          liquidacionAutorizadaPorId: null,
        },
        include: { producto: true, variante: true, sede: true },
      });

      await tx.productoPrecioHistorialSede.create({
        data: {
          productoStockId: stock.id,
          sedeId: stock.sedeId,
          precioAnterior: stock.precio,
          precioNuevo: stock.precio,
          precioCostoAnterior: stock.precioCosto,
          precioCostoNuevo: stock.precioCosto,
          precioOfertaAnterior: stock.precioLiquidacion,
          precioOfertaNuevo: stock.precioOferta,
          tipoCambio: TipoCambioPrecio.LIQUIDACION,
          razon: razon ? `Liquidación desactivada: ${razon}` : 'Liquidación desactivada',
          origenModulo: 'LIQUIDACION',
          usuarioId,
        },
      });

      return result;
    });

    await this.invalidateProductCache(empresaId);
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    this.logger.log(
      `Liquidación desactivada para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre}` +
        (razon ? ` (razón: ${razon})` : ''),
    );

    return updated;
  }

  /**
   * Lista los productos en liquidación activa por sede (vigentes según fechas).
   */
  async listarLiquidacionesActivas(
    empresaId: string,
    sedeId?: string,
    page = 1,
    limit = 50,
  ) {
    const now = new Date();
    const where: Prisma.ProductoStockWhereInput = {
      empresaId,
      enLiquidacion: true,
      ...(sedeId ? { sedeId } : {}),
      OR: [
        { fechaFinLiquidacion: null },
        { fechaFinLiquidacion: { gte: now } },
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.productoStock.count({ where }),
      this.prisma.productoStock.findMany({
        where,
        include: {
          producto: { select: { id: true, nombre: true, codigoEmpresa: true, sku: true } },
          variante: { select: { id: true, nombre: true, sku: true } },
          sede: { select: { id: true, nombre: true } },
          liquidacionAutorizadaPor: {
            select: { id: true, persona: { select: { nombres: true, apellidos: true } } },
          },
        },
        orderBy: { fechaInicioLiquidacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return createPaginatedResponse(rows, total, page, limit);
  }

  /**
   * Cron diario que limpia liquidaciones cuya fechaFin ya pasó.
   * Mantiene el campo de auditoría pero las desmarca para que no se apliquen
   * en ventas nuevas.
   */
  @Cron('0 5 * * *')
  async cronExpirarLiquidaciones() {
    const now = new Date();
    const result = await this.prisma.productoStock.updateMany({
      where: {
        enLiquidacion: true,
        fechaFinLiquidacion: { not: null, lt: now },
      },
      data: {
        enLiquidacion: false,
        precioLiquidacion: null,
        motivoLiquidacion: null,
      },
    });
    if (result.count > 0) {
      this.logger.log(`Cron liquidaciones: ${result.count} expiradas desactivadas`);
    }
  }

  // =====================================================
  // VERIFICACIÓN / AUDITORÍA DE PRECIOS
  // =====================================================

  /**
   * Construye el where Prisma según el campo + modo del filtro.
   * Usado por verificarPrecios y exportVerificacionPrecios.
   */
  private _buildVerificacionWhere(
    empresaId: string,
    dto: VerificarPreciosDto,
  ): Prisma.ProductoStockWhereInput {
    const where: Prisma.ProductoStockWhereInput = { empresaId };
    if (dto.sedeId) where.sedeId = dto.sedeId;

    // Cuando hay filtro de comparación, ignoramos campo/modo/min/max/exacto
    // y aplicamos solo el guard de NOT NULL que necesita el modo. La
    // comparación columna-vs-columna se hace post-fetch (Prisma no soporta
    // comparar dos columnas en el where).
    if (dto.comparacion) {
      if (dto.comparacion === ComparacionPrecio.SIN_COSTO) {
        where.precio = { not: null };
        where.precioCosto = null;
      } else {
        // PERDIDA / SIN_MARGEN / MARGEN_BAJO: ambos necesarios para comparar
        where.precio = { not: null };
        where.precioCosto = { not: null };
      }
    } else {
      const campo = dto.campo ?? CampoPrecio.COSTO;
      const modo = dto.modo ?? ModoVerificacion.RANGO;

      const campoMap: Record<
        CampoPrecio,
        keyof Prisma.ProductoStockWhereInput
      > = {
        [CampoPrecio.PRECIO]: 'precio',
        [CampoPrecio.COSTO]: 'precioCosto',
        [CampoPrecio.OFERTA]: 'precioOferta',
        [CampoPrecio.LIQUIDACION]: 'precioLiquidacion',
      };
      const campoKey = campoMap[campo];

      // Filtro por valor del campo seleccionado
      if (modo === ModoVerificacion.SIN_VALOR) {
        (where as any)[campoKey] = null;
      } else if (modo === ModoVerificacion.EXACTO && dto.exacto != null) {
        (where as any)[campoKey] = new Prisma.Decimal(dto.exacto);
      } else if (modo === ModoVerificacion.RANGO) {
        const filtroRango: any = { not: null };
        if (dto.min != null) filtroRango.gte = new Prisma.Decimal(dto.min);
        if (dto.max != null) filtroRango.lte = new Prisma.Decimal(dto.max);
        // Si no se pasa min/max el modo RANGO trae todos los que tienen valor.
        (where as any)[campoKey] = filtroRango;
      }
    }

    // Filtros sobre el producto relacionado (categoría, marca, activo).
    // Nota: empresaCategoria/Marca tienen nombre via relación con maestro
    // o nombrePersonalizado — la UI filtra por ID así que aceptamos eso
    // directamente sin resolver el nombre.
    const productoFilter: Prisma.ProductoWhereInput = {};
    if (dto.empresaCategoriaId)
      productoFilter.empresaCategoriaId = dto.empresaCategoriaId;
    if (dto.empresaMarcaId) productoFilter.empresaMarcaId = dto.empresaMarcaId;
    if (dto.soloActivos !== false) {
      productoFilter.isActive = true;
      productoFilter.deletedAt = null;
    }
    if (Object.keys(productoFilter).length > 0) {
      where.producto = productoFilter;
    }

    // Filtro por stock
    if (dto.stock === FiltroStock.CON) {
      where.stockActual = { gt: 0 };
    } else if (dto.stock === FiltroStock.SIN) {
      where.stockActual = { lte: 0 };
    }

    return where;
  }

  /**
   * Filtra en JS las comparaciones que Prisma no expresa en `where`
   * (columna vs columna). Se aplica DESPUÉS del findMany. Las filas ya
   * vienen pre-filtradas por NOT NULL desde el where, así que precio y
   * precioCosto son seguros de leer (excepto en SIN_COSTO, que no
   * requiere comparación).
   */
  private _aplicarComparacionPrecio<
    T extends {
      precio: DecimalType | null;
      precioCosto: DecimalType | null;
    },
  >(
    stocks: T[],
    comparacion: ComparacionPrecio | undefined,
    margenMinimo: number,
  ): T[] {
    if (!comparacion || comparacion === ComparacionPrecio.SIN_COSTO) {
      // SIN_COSTO ya queda resuelto por el where (precio NOT NULL, costo NULL).
      return stocks;
    }
    return stocks.filter((s) => {
      const precio = s.precio != null ? Number(s.precio) : null;
      const costo = s.precioCosto != null ? Number(s.precioCosto) : null;
      if (precio == null || costo == null) return false;
      switch (comparacion) {
        case ComparacionPrecio.PERDIDA:
          return costo > precio;
        case ComparacionPrecio.SIN_MARGEN:
          return costo === precio;
        case ComparacionPrecio.MARGEN_BAJO: {
          if (precio === 0) return false; // evita división por cero
          const margenPct = ((precio - costo) / precio) * 100;
          return margenPct < margenMinimo;
        }
        default:
          return false;
      }
    });
  }

  /**
   * Lista de productos+sede para auditoría de precios. Response plano y
   * liviano (sin paginar — se limita por `limit`, default 500). Pensado
   * para localizar precios mal cargados via filtros por valor.
   */
  async verificarPrecios(empresaId: string, dto: VerificarPreciosDto) {
    const where = this._buildVerificacionWhere(empresaId, dto);
    const limit = Number(dto.limit ?? 500);
    // Cuando hay comparación columna-vs-columna (PERDIDA/SIN_MARGEN/
    // MARGEN_BAJO) filtramos post-fetch; el `take` del DB no sabe cuántas
    // filas pasan el filtro. Subimos el cap a 5000 para no quedar cortos
    // en empresas grandes. Para los demás casos mantenemos `take = limit`.
    const requiereComparacionPostFetch =
      dto.comparacion != null && dto.comparacion !== ComparacionPrecio.SIN_COSTO;
    const fetchTake = requiereComparacionPostFetch ? 5000 : limit;
    // OPTIMIZACIÓN: el orderBy por relación (producto.nombre + sede.nombre)
    // dispara subqueries caros en Postgres sin índice compuesto. Para
    // datasets ≤5k filas conviene traer sin orden y ordenar en JS. Reduce
    // el query de ~800ms a ~150ms en empresas con muchos productos.
    const stocksRaw = await this.prisma.productoStock.findMany({
      where,
      take: fetchTake,
      include: {
        producto: {
          select: { id: true, nombre: true, codigoEmpresa: true },
        },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });
    const stocksFiltrados = this._aplicarComparacionPrecio(
      stocksRaw,
      dto.comparacion,
      Number(dto.margenMinimo ?? 10),
    );
    stocksFiltrados.sort((a, b) => {
      const pn = (a.producto?.nombre ?? '').localeCompare(
        b.producto?.nombre ?? '',
      );
      if (pn !== 0) return pn;
      return (a.sede?.nombre ?? '').localeCompare(b.sede?.nombre ?? '');
    });
    // Trim al límite visible y marcamos limitAlcanzado si:
    //  - sin comparación: cuando `stocksRaw.length === limit` (= take = limit)
    //  - con comparación: cuando hay más resultados post-filtro que `limit`
    //    o cuando llenamos el cap de 5000 (puede haber más candidatos sin evaluar)
    const limitAlcanzado = requiereComparacionPostFetch
      ? stocksFiltrados.length > limit || stocksRaw.length === fetchTake
      : stocksFiltrados.length === limit;
    const stocks = stocksFiltrados.slice(0, limit);

    return {
      total: stocks.length,
      limitAlcanzado,
      items: stocks.map((s) => ({
        id: s.id,
        productoId: s.productoId,
        varianteId: s.varianteId,
        codigoEmpresa: s.producto?.codigoEmpresa ?? null,
        nombre:
          s.variante?.nombre != null
            ? `${s.producto?.nombre ?? ''} — ${s.variante.nombre}`
            : (s.producto?.nombre ?? ''),
        sedeId: s.sede.id,
        sedeNombre: s.sede.nombre,
        stockActual: s.stockActual,
        precio: s.precio != null ? Number(s.precio) : null,
        precioCosto: s.precioCosto != null ? Number(s.precioCosto) : null,
        precioOferta: s.precioOferta != null ? Number(s.precioOferta) : null,
        precioLiquidacion:
          s.precioLiquidacion != null ? Number(s.precioLiquidacion) : null,
        enOferta: s.enOferta,
        enLiquidacion: s.enLiquidacion,
        precioConfigurado: s.precioConfigurado,
      })),
    };
  }

  /**
   * Exporta verificación a Excel. Mismas filas que verificarPrecios pero
   * sin límite (configurable, default 5000 para no romper memoria).
   */
  async exportVerificacionPrecios(
    empresaId: string,
    dto: VerificarPreciosDto,
    res: Response,
  ) {
    const where = this._buildVerificacionWhere(empresaId, dto);
    const limit = Number(dto.limit ?? 5000);
    // Mismo criterio que verificarPrecios: orderBy en JS, no en DB.
    // Cuando hay comparación post-fetch evaluamos hasta el `limit` directo
    // (que para export ya es alto, default 5000) — no necesitamos un cap
    // extra como en verificarPrecios porque acá el "límite visible" y el
    // "límite de evaluación" coinciden.
    const stocksRaw = await this.prisma.productoStock.findMany({
      where,
      take: limit,
      include: {
        producto: { select: { nombre: true, codigoEmpresa: true } },
        variante: { select: { nombre: true, sku: true } },
        sede: { select: { nombre: true } },
      },
    });
    const stocks = this._aplicarComparacionPrecio(
      stocksRaw,
      dto.comparacion,
      Number(dto.margenMinimo ?? 10),
    );
    stocks.sort((a, b) => {
      const pn = (a.producto?.nombre ?? '').localeCompare(
        b.producto?.nombre ?? '',
      );
      if (pn !== 0) return pn;
      return (a.sede?.nombre ?? '').localeCompare(b.sede?.nombre ?? '');
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Syncronize';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Verificación precios');
    sheet.columns = [
      { header: 'Código', key: 'codigo', width: 14 },
      { header: 'Producto', key: 'nombre', width: 38 },
      { header: 'Variante', key: 'variante', width: 18 },
      { header: 'Sede', key: 'sede', width: 16 },
      { header: 'Stock', key: 'stock', width: 8 },
      { header: 'Precio venta', key: 'precio', width: 13 },
      { header: 'Precio costo', key: 'costo', width: 13 },
      { header: 'Precio oferta', key: 'oferta', width: 13 },
      { header: 'Precio liquidación', key: 'liquidacion', width: 16 },
      { header: 'En oferta', key: 'enOferta', width: 10 },
      { header: 'En liquidación', key: 'enLiquidacion', width: 13 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1565C0' },
    };
    headerRow.alignment = { horizontal: 'center' };
    headerRow.height = 22;

    for (const s of stocks) {
      sheet.addRow({
        codigo: s.producto?.codigoEmpresa ?? '',
        nombre: s.producto?.nombre ?? '',
        variante: s.variante?.nombre ?? '',
        sede: s.sede.nombre,
        stock: s.stockActual,
        precio: s.precio != null ? Number(s.precio) : null,
        costo: s.precioCosto != null ? Number(s.precioCosto) : null,
        oferta: s.precioOferta != null ? Number(s.precioOferta) : null,
        liquidacion:
          s.precioLiquidacion != null ? Number(s.precioLiquidacion) : null,
        enOferta: s.enOferta ? 'Sí' : '',
        enLiquidacion: s.enLiquidacion ? 'Sí' : '',
      });
    }

    // Format moneda para columnas de precios
    for (const col of [6, 7, 8, 9]) {
      sheet.getColumn(col).numFmt = '#,##0.00';
    }

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=verificacion_precios_${new Date().toISOString().slice(0, 10)}.xlsx`,
    });
    await wb.xlsx.write(res);
    res.end();
  }
}
