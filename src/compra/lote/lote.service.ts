import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { createCursorPaginatedResponse } from '../../common/utils/pagination.util';
import { Prisma, EstadoLote, TipoMovimientoStock } from '@prisma/client';
import {
  CorregirVencimientoLoteDto,
  DarDeBajaLoteDto,
  QueryLotesDto,
} from '../dto';
import { crearMovimientoStockConValoracion } from '../../producto-stock/movimiento-stock.helper';

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
        // 🔑 Por NOMBRE del producto, que es como la gente busca: nadie se
        // acuerda del código de un lote. Van los dos nombres porque en un
        // producto con variantes el que identifica la fila es el de la
        // variante — `ProductoStock` es XOR, cada lote cuelga de uno solo.
        {
          productoStock: {
            producto: {
              nombre: { contains: filtros.search, mode: 'insensitive' },
            },
          },
        },
        {
          productoStock: {
            variante: {
              nombre: { contains: filtros.search, mode: 'insensitive' },
            },
          },
        },
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
  /**
   * Saca un lote del inventario: se venció, se rompió, se perdió.
   *
   * 🔴 Es la ÚNICA salida cuando un producto de CADUCIDAD vence. El guard de
   * la venta lo bloquea sin autorización posible, y como FEFO pone lo vencido
   * PRIMERO en la fila, sin esto ese lote frena toda venta de ese producto
   * para siempre. El mensaje de error le dice al cajero que haga esto; hasta
   * hoy no había dónde.
   *
   * 🔑 Baja el lote Y el `stockActual` juntos, en una transacción: si moviera
   * uno solo, la invariante `Σ lotes = stockActual` se rompe y el consumo
   * FEFO empieza a repartir mercadería que no existe.
   *
   * El movimiento va con `lotesGestionadosPorElLlamador` porque acá se elige
   * un lote CONCRETO; dejar que el helper consuma por FEFO descontaría de otro
   * y además dos veces.
   */
  async darDeBaja(
    id: string,
    empresaId: string,
    usuarioId: string,
    dto: DarDeBajaLoteDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lote = await tx.lote.findFirst({
        where: { id, empresaId },
        include: {
          productoStock: { select: { id: true, stockActual: true } },
          producto: { select: { nombre: true } },
          variante: { select: { nombre: true } },
        },
      });
      if (!lote) throw new NotFoundException('Lote no encontrado');
      if (lote.cantidadActual <= 0) {
        throw new BadRequestException(
          `El lote ${lote.codigo} ya no tiene unidades: no hay nada que dar de baja.`,
        );
      }

      const cantidad = dto.cantidad ?? lote.cantidadActual;
      if (cantidad > lote.cantidadActual) {
        throw new BadRequestException(
          `El lote ${lote.codigo} tiene ${lote.cantidadActual} unidades y se ` +
            `quieren dar de baja ${cantidad}.`,
        );
      }

      const stock = lote.productoStock;
      const quedaEnLote = lote.cantidadActual - cantidad;
      // Piso en 0: si el stock ya estuviera por debajo (una inconsistencia
      // vieja), dejarlo negativo lo empeora.
      const nuevoStock = Math.max(0, stock.stockActual - cantidad);

      await tx.lote.update({
        where: { id: lote.id },
        data: {
          cantidadActual: quedaEnLote,
          ...(quedaEnLote === 0 ? { estado: EstadoLote.AGOTADO } : {}),
          observaciones: `Baja de ${cantidad}: ${dto.motivo}`,
        },
      });

      await tx.productoStock.update({
        where: { id: stock.id },
        data: { stockActual: nuevoStock },
      });

      const nombre =
        lote.variante?.nombre ?? lote.producto?.nombre ?? 'producto';
      const movimiento = await crearMovimientoStockConValoracion(tx, {
        empresaId,
        sedeId: lote.sedeId,
        productoStockId: stock.id,
        tipo: TipoMovimientoStock.SALIDA_BAJA,
        tipoDocumento: 'BAJA_LOTE',
        numeroDocumento: lote.codigo,
        cantidadAnterior: stock.stockActual,
        cantidad: -cantidad,
        cantidadNueva: nuevoStock,
        motivo: `Baja del lote ${lote.codigo} (${nombre}): ${dto.motivo}`,
        usuarioId,
        // Valorado al costo DE ESTE LOTE: es la mercadería concreta que se
        // pierde, no un promedio.
        precioCostoUnitario: lote.precioCosto,
        // Acá se elige el lote a mano; el helper no debe tocar ninguno.
        lotesGestionadosPorElLlamador: true,
      });

      // La contrapartida en la tabla puente, para que el movimiento sepa de
      // qué lote salió igual que cualquier otra salida.
      await tx.movimientoStockLote.create({
        data: {
          movimientoStockId: movimiento.id,
          loteId: lote.id,
          cantidad,
          costoUnitario: lote.precioCosto,
        },
      });

      this.logger.warn(
        `Baja de lote ${lote.codigo}: ${cantidad} unidades de ${nombre} — ${dto.motivo}`,
      );

      return {
        loteId: lote.id,
        codigo: lote.codigo,
        dadasDeBaja: cantidad,
        quedanEnLote: quedaEnLote,
        stockActual: nuevoStock,
      };
    });
  }

  /**
   * Corrige la fecha de vencimiento de un lote mal cargada.
   *
   * 🔑 La otra salida del bloqueo de CADUCIDAD: si la fecha se tipeó mal, no
   * hay que tirar mercadería buena — hay que arreglar el dato.
   *
   * 🔴 Queda RASTRO en las observaciones a propósito. Cambiar un vencimiento
   * es exactamente lo que alguien haría para saltarse el bloqueo, así que
   * tiene que poder auditarse: qué decía antes, qué dice ahora, quién y por qué.
   */
  async corregirVencimiento(
    id: string,
    empresaId: string,
    usuarioId: string,
    dto: CorregirVencimientoLoteDto,
  ) {
    const lote = await this.prisma.lote.findFirst({ where: { id, empresaId } });
    if (!lote) throw new NotFoundException('Lote no encontrado');

    const nueva = dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null;
    const antes = lote.fechaVencimiento
      ? lote.fechaVencimiento.toISOString().slice(0, 10)
      : 'sin vencimiento';
    const ahora = nueva ? nueva.toISOString().slice(0, 10) : 'sin vencimiento';

    // Un lote marcado VENCIDO cuya fecha corregida todavía no llegó vuelve a
    // estar disponible. Al revés NO: marcarlo vencido es tarea del cron, que
    // corre con su propio criterio.
    const revive =
      lote.estado === EstadoLote.VENCIDO && (!nueva || nueva > new Date());

    const actualizado = await this.prisma.lote.update({
      where: { id: lote.id },
      data: {
        fechaVencimiento: nueva,
        ...(revive ? { estado: EstadoLote.ACTIVO } : {}),
        observaciones:
          `Vencimiento corregido: ${antes} → ${ahora}. ${dto.motivo} ` +
          `(${usuarioId}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
      },
    });

    this.logger.warn(
      `Vencimiento del lote ${lote.codigo}: ${antes} → ${ahora} — ${dto.motivo}`,
    );

    return actualizado;
  }
}
