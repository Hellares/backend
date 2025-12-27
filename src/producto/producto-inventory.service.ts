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
 * - Stock de productos y variantes
 * - Actualización de stock
 * - Cálculo de stock total
 * - Validaciones de stock
 * - Stock de combos (delegando a ProductoComboService)
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
   * @throws BadRequestException si el producto tiene variantes
   * @throws NotFoundException si el producto no existe
   */
  async updateStock(
    id: string,
    empresaId: string,
    cantidad: number,
    operacion: 'agregar' | 'quitar',
  ): Promise<{ stock: number }> {
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
    });

    this.logger.info(`Stock actualizado para producto ${id}`, {
      stockAnterior: producto.stock,
      stockNuevo: nuevoStock,
      operacion,
      cantidad,
    });

    return { stock: productoActualizado.stock };
  }

  // =====================================================
  // CÁLCULO DE STOCK TOTAL
  // =====================================================

  /**
   * Obtiene el stock total de un producto
   * - Si tiene variantes: suma el stock de todas las variantes activas
   * - Si no tiene variantes: retorna el stock del producto base
   */
  async getStockTotal(productoId: string, empresaId: string): Promise<number> {
    const producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Si tiene variantes, sumar stock de todas las variantes activas
    if (producto.tieneVariantes) {
      const result = await this.prisma.productoVariante.aggregate({
        where: {
          productoId,
          isActive: true,
          deletedAt: null,
        },
        _sum: {
          stock: true,
        },
      });

      return result._sum.stock || 0;
    }

    // Si no tiene variantes, retornar stock del producto base
    return producto.stock;
  }

  /**
   * Obtiene el stock disponible de un combo
   * Delega a ProductoComboService para evitar dependencia circular
   * Este método resuelve la dependencia circular:
   * - ProductoService necesitaba ProductoComboService
   * - Ahora ProductoInventoryService lo inyecta (sin circular porque ComboService no usa InventoryService)
   */
  async getStockCombo(comboId: string): Promise<number> {
    return await this.comboService.getStockDisponibleCombo(comboId);
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
   */
  async getProductosStockBajo(
    empresaId: string,
  ): Promise<Array<{ id: string; nombre: string; stock: number; stockMinimo: number }>> {
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        deletedAt: null,
        isActive: true,
        stock: {
          lte: this.prisma.producto.fields.stockMinimo,
        },
      },
      select: {
        id: true,
        nombre: true,
        stock: true,
        stockMinimo: true,
      },
      orderBy: {
        stock: 'asc',
      },
    });

    return productos;
  }
}
