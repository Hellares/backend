import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { createCursorPaginatedResponse } from '../../common/utils/pagination.util';
import { Prisma, EstadoLote } from '@prisma/client';
import { QueryLotesDto } from '../dto';

@Injectable()
export class LoteService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(LoteService.name);
  }

  /**
   * Listar lotes con filtros y paginación
   */
  async findAll(empresaId: string, filtros?: QueryLotesDto) {
    const where: Prisma.LoteWhereInput = { empresaId };

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.productoStockId) where.productoStockId = filtros.productoStockId;
    if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;
    if (filtros?.estado) where.estado = filtros.estado;

    if (filtros?.search) {
      where.OR = [
        // startsWith usa el índice @@unique([empresaId, codigo])
        { codigo: { startsWith: filtros.search, mode: 'insensitive' } },
        { numeroLote: { contains: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const limit = filtros?.limit ?? 10;

    const paginationArgs: Prisma.LoteFindManyArgs = filtros?.cursor
      ? { cursor: { id: filtros.cursor }, skip: 1, take: limit }
      : { take: limit };

    const [data, total] = await Promise.all([
      this.prisma.lote.findMany({
        where,
        include: {
          productoStock: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
            },
          },
          sede: { select: { id: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true } },
        },
        orderBy: { creadoEn: 'desc' },
        ...paginationArgs,
      }),
      this.prisma.lote.count({ where }),
    ]);

    return createCursorPaginatedResponse(data, total, limit, (item) => item.id);
  }

  /**
   * Obtener detalle de un lote
   */
  async findOne(id: string, empresaId: string) {
    const lote = await this.prisma.lote.findFirst({
      where: { id, empresaId },
      include: {
        productoStock: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
        sede: { select: { id: true, nombre: true } },
        proveedor: { select: { id: true, nombre: true } },
        compra: { select: { id: true, codigo: true } },
        detallesCompra: true,
      },
    });

    if (!lote) {
      throw new NotFoundException('Lote no encontrado');
    }

    return lote;
  }

  /**
   * Lotes de un ProductoStock ordenados por fechaIngreso ASC (FIFO)
   */
  async getLotesPorProductoStock(productoStockId: string, empresaId: string) {
    return this.prisma.lote.findMany({
      where: {
        productoStockId,
        empresaId,
        estado: EstadoLote.ACTIVO,
      },
      orderBy: { fechaIngreso: 'asc' },
      include: {
        proveedor: { select: { id: true, nombre: true } },
      },
    });
  }

  /**
   * Consumir lotes en orden FIFO (para ventas/salidas)
   * Devuelve los lotes consumidos con sus cantidades
   * Respeta cantidadReservada: solo consume stock disponible (cantidadActual - cantidadReservada)
   */
  async consumirLotesFIFO(
    productoStockId: string,
    cantidad: number,
    tx: Prisma.TransactionClient,
  ): Promise<Array<{ loteId: string; cantidadConsumida: number }>> {
    const lotes = await tx.lote.findMany({
      where: {
        productoStockId,
        estado: EstadoLote.ACTIVO,
        cantidadActual: { gt: 0 },
      },
      orderBy: { fechaIngreso: 'asc' },
    });

    let restante = cantidad;
    const consumidos: Array<{ loteId: string; cantidadConsumida: number }> = [];

    for (const lote of lotes) {
      if (restante <= 0) break;

      // Respetar cantidadReservada: solo consumir stock disponible
      const disponible = lote.cantidadActual - lote.cantidadReservada;
      if (disponible <= 0) continue;

      const consumir = Math.min(disponible, restante);
      const nuevaCantidad = lote.cantidadActual - consumir;

      await tx.lote.update({
        where: { id: lote.id },
        data: {
          cantidadActual: nuevaCantidad,
          estado: nuevaCantidad === 0 ? EstadoLote.AGOTADO : EstadoLote.ACTIVO,
        },
      });

      consumidos.push({ loteId: lote.id, cantidadConsumida: consumir });
      restante -= consumir;
    }

    if (restante > 0) {
      this.logger.warn(
        `No hay suficientes lotes para cubrir ${cantidad} unidades de productoStockId=${productoStockId}. Faltan ${restante}`,
      );
    }

    return consumidos;
  }

  /**
   * Lotes próximos a vencer
   */
  async getLotesProximosVencer(empresaId: string, dias: number = 30) {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + dias);

    return this.prisma.lote.findMany({
      where: {
        empresaId,
        estado: EstadoLote.ACTIVO,
        fechaVencimiento: {
          not: null,
          lte: fechaLimite,
        },
        cantidadActual: { gt: 0 },
      },
      include: {
        productoStock: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
        sede: { select: { id: true, nombre: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  /**
   * Marcar lotes vencidos como VENCIDO
   */
  async marcarLotesVencidos(empresaId: string) {
    const now = new Date();

    const result = await this.prisma.lote.updateMany({
      where: {
        empresaId,
        estado: EstadoLote.ACTIVO,
        fechaVencimiento: {
          not: null,
          lt: now,
        },
      },
      data: {
        estado: EstadoLote.VENCIDO,
      },
    });

    this.logger.log(`Marcados ${result.count} lotes como vencidos para empresa ${empresaId}`);
    return { lotesActualizados: result.count };
  }

  /**
   * Resumen de costos por ProductoStock
   */
  async getResumenCostoPorProducto(productoStockId: string, empresaId: string) {
    const lotes = await this.prisma.lote.findMany({
      where: {
        productoStockId,
        empresaId,
        estado: { in: [EstadoLote.ACTIVO, EstadoLote.AGOTADO] },
      },
      select: {
        precioCosto: true,
        cantidadActual: true,
        cantidadInicial: true,
        estado: true,
      },
    });

    const lotesActivos = lotes.filter((l) => l.estado === EstadoLote.ACTIVO);
    const totalStock = lotesActivos.reduce((sum, l) => sum + l.cantidadActual, 0);

    let costoPromedio = 0;
    if (totalStock > 0) {
      const costoTotal = lotesActivos.reduce(
        (sum, l) => sum + Number(l.precioCosto) * l.cantidadActual,
        0,
      );
      costoPromedio = Math.round((costoTotal / totalStock) * 100) / 100;
    }

    const precios = lotes.map((l) => Number(l.precioCosto));
    const costoMinimo = precios.length > 0 ? Math.min(...precios) : 0;
    const costoMaximo = precios.length > 0 ? Math.max(...precios) : 0;

    return {
      totalStock,
      costoPromedio,
      costoMinimo,
      costoMaximo,
      totalLotes: lotes.length,
      lotesActivos: lotesActivos.length,
    };
  }
}
