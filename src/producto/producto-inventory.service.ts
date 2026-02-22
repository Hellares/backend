import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ProductoComboService } from './producto-combo.service';

/**
 * Servicio especializado para gestión de inventario
 * Responsabilidades:
 * - Stock de productos y variantes (MIGRADO A ProductoStock)
 * - Actualización de stock por sede
 * - Cálculo de stock total
 * - Validaciones de stock
 * - Stock de combos (delegando a ProductoComboService)
 *
 * IMPORTANTE: Este servicio ahora usa ProductoStock (sistema nuevo)
 * Los campos legacy Producto.stock y ProductoVariante.stock están deprecated
 */
@Injectable()
export class ProductoInventoryService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private comboService: ProductoComboService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoInventoryService.name);
  }

  // =====================================================
  // ACTUALIZACIÓN DE STOCK
  // =====================================================

  /**
   * Actualiza el stock de un producto sin variantes
   * MIGRADO: Ahora usa ProductoStock en lugar de Producto.stock
   *
   * @param id - ID del producto
   * @param empresaId - ID de la empresa
   * @param sedeId - ID de la sede donde actualizar el stock
   * @param cantidad - Cantidad a agregar/quitar
   * @param operacion - 'agregar' o 'quitar'
   * @param usuarioId - ID del usuario que realiza la operación
   * @throws BadRequestException si el producto tiene variantes
   * @throws NotFoundException si el producto no existe o no tiene stock en la sede
   */
  async updateStock(
    id: string,
    empresaId: string,
    sedeId: string,
    cantidad: number,
    operacion: 'agregar' | 'quitar',
    usuarioId: string,
  ): Promise<{ stock: number; stockTotal: number }> {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId, isActive: true, deletedAt: null },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Validar que el producto no tenga variantes
    if (producto.tieneVariantes) {
      throw new BadRequestException(
        'No se puede actualizar el stock directamente en productos con variantes. ' +
          'Actualice el stock de cada variante individualmente.',
      );
    }

    // Calcular ajuste
    const cantidadAjuste = operacion === 'agregar' ? cantidad : -cantidad;

    // Transacción atómica: lectura + validación + escritura dentro de la misma transacción
    const { stockAnterior, nuevoStock, productoStockId } = await this.prisma.$transaction(async (tx) => {
      // Leer dentro de la transacción para evitar race conditions
      const productoStock = await tx.productoStock.findFirst({
        where: {
          productoId: id,
          sedeId,
          empresaId,
        },
      });

      if (!productoStock) {
        throw new NotFoundException(
          `El producto no tiene stock registrado en la sede especificada. ` +
            `Use el endpoint POST /producto-stock para crear el stock inicial.`,
        );
      }

      const stockAnterior = productoStock.stockActual;
      const nuevoStock = stockAnterior + cantidadAjuste;

      if (nuevoStock < 0) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${stockAnterior}, Solicitado: ${cantidad}`,
        );
      }

      // Actualizar stock con increment/decrement atómico
      await tx.productoStock.update({
        where: { id: productoStock.id },
        data: { stockActual: { increment: cantidadAjuste } },
      });

      // Registrar movimiento
      await tx.movimientoStock.create({
        data: {
          sedeId,
          empresaId,
          productoStockId: productoStock.id,
          tipo: operacion === 'agregar' ? 'ENTRADA_AJUSTE' : 'SALIDA_AJUSTE',
          tipoDocumento: 'AJUSTE_MANUAL',
          cantidadAnterior: stockAnterior,
          cantidad: cantidadAjuste,
          cantidadNueva: nuevoStock,
          motivo: `Ajuste ${operacion === 'agregar' ? 'entrada' : 'salida'} manual`,
          usuarioId,
        },
      });

      return { stockAnterior, nuevoStock, productoStockId: productoStock.id };
    });

    // Calcular stock total (todas las sedes)
    const stockTotal = await this.getStockTotal(id, empresaId);

    this.logger.info(`Stock actualizado para producto ${id} en sede ${sedeId}`, {
      stockAnterior,
      stockNuevo: nuevoStock,
      operacion,
      cantidad,
      stockTotal,
    });

    return { stock: nuevoStock, stockTotal };
  }

  // =====================================================
  // CÁLCULO DE STOCK TOTAL
  // =====================================================

  /**
   * Obtiene el stock total de un producto en TODAS las sedes
   * Usa un solo query: verifica existencia + suma stock directo y de variantes activas
   */
  async getStockTotal(productoId: string, empresaId: string): Promise<number> {
    const [result] = await this.prisma.$queryRaw<
      Array<{ exists: boolean; total: bigint }>
    >`SELECT
        EXISTS(
          SELECT 1 FROM "Producto"
          WHERE id = ${productoId} AND "empresaId" = ${empresaId} AND "deletedAt" IS NULL
        ) AS exists,
        COALESCE((
          SELECT SUM(ps."stockActual")
          FROM "ProductoStock" ps
          WHERE ps."empresaId" = ${empresaId}
            AND (
              ps."productoId" = ${productoId}
              OR ps."varianteId" IN (
                SELECT pv.id FROM "ProductoVariante" pv
                WHERE pv."productoId" = ${productoId}
                  AND pv."isActive" = true
                  AND pv."deletedAt" IS NULL
              )
            )
        ), 0) AS total`;

    if (!result.exists) {
      throw new NotFoundException('Producto no encontrado');
    }

    return Number(result.total);
  }

  /**
   * Obtiene el stock disponible de un combo
   * Delega a ProductoComboService para evitar dependencia circular
   * Este método resuelve la dependencia circular:
   * - ProductoService necesitaba ProductoComboService
   * - Ahora ProductoInventoryService lo inyecta (sin circular porque ComboService no usa InventoryService)
   * @param sedeId - Requerido para obtener stock por sede
   */
  async getStockCombo(comboId: string, sedeId: string): Promise<number> {
    return await this.comboService.getStockDisponibleCombo(comboId, sedeId);
  }

  // =====================================================
  // VALIDACIONES DE STOCK
  // =====================================================

  /**
   * Valida si hay stock suficiente para una cantidad solicitada
   */
  async validateStockSuficiente(
    productoId: string,
    empresaId: string,
    cantidad: number,
  ): Promise<boolean> {
    const stockTotal = await this.getStockTotal(productoId, empresaId);
    return stockTotal >= cantidad;
  }

  /**
   * Obtiene productos con stock bajo (menor o igual al stock mínimo)
   * MIGRADO: Ahora usa ProductoStock
   * @deprecated Use ProductoStockService.getProductosBajoMinimo() en su lugar
   */
  async getProductosStockBajo(
    empresaId: string,
    sedeId?: string,
  ): Promise<
    Array<{
      id: string;
      nombre: string;
      stock: number;
      stockMinimo: number;
      sedeId: string;
      sedeName: string;
    }>
  > {
    const where: any = {
      empresaId,
      stockMinimo: { not: null },
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    const productosBajos = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: {
        stockActual: 'asc',
      },
    });

    // Filtrar donde stockActual <= stockMinimo
    const filtrados = productosBajos
      .filter((p) => p.stockMinimo && p.stockActual <= p.stockMinimo)
      .map((p) => ({
        id: p.producto?.id || p.variante?.id || '',
        nombre: p.producto?.nombre || p.variante?.nombre || '',
        stock: p.stockActual,
        stockMinimo: p.stockMinimo || 0,
        sedeId: p.sedeId,
        sedeName: p.sede.nombre,
      }));

    return filtrados;
  }

  /**
   * Obtiene el stock de un producto en una sede específica
   */
  async getStockPorSede(
    productoId: string,
    sedeId: string,
    empresaId: string,
  ): Promise<number> {
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        productoId,
        sedeId,
        empresaId,
      },
    });

    return stock?.stockActual || 0;
  }

  /**
   * Obtiene el stock de una variante en una sede específica
   */
  async getStockVariantePorSede(
    varianteId: string,
    sedeId: string,
    empresaId: string,
  ): Promise<number> {
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        varianteId,
        sedeId,
        empresaId,
      },
    });

    return stock?.stockActual || 0;
  }
}
