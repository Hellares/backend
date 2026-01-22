import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearStockDto } from './dto/crear-stock.dto';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { Prisma } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';

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

    return await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId || null,
        varianteId: varianteId || null,
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
    // Validar que se proporcione producto o variante
    if (!dto.productoId && !dto.varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
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
        productoId: dto.productoId || null,
        varianteId: dto.varianteId || null,
      },
    });

    if (existente) {
      throw new BadRequestException(
        'Ya existe un registro de stock para este producto/variante en esta sede',
      );
    }

    // Crear stock y movimiento inicial en transacción
    return await this.prisma.$transaction(async (tx) => {
      // Crear registro de stock
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
   */
  async ajustarStock(
    productoStockId: string,
    empresaId: string,
    dto: AjustarStockDto,
    usuarioId: string,
  ) {
    // Obtener stock actual
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: {
        producto: true,
        variante: true,
      },
    });

    if (!stock) {
      throw new NotFoundException('Stock no encontrado');
    }

    // Validar que el producto o variante siga activo
    if (stock.producto && !stock.producto.isActive) {
      throw new BadRequestException(
        'No se puede ajustar stock de un producto inactivo',
      );
    }

    if (stock.variante && !stock.variante.isActive) {
      throw new BadRequestException(
        'No se puede ajustar stock de una variante inactiva',
      );
    }

    // Calcular nuevo stock
    const nuevoStock = stock.stockActual + dto.cantidad;

    // Validar que no quede negativo
    if (nuevoStock < 0) {
      throw new BadRequestException(
        `Stock insuficiente. Actual: ${stock.stockActual}, Requerido: ${Math.abs(dto.cantidad)}`,
      );
    }

    // Actualizar stock y registrar movimiento en transacción
    return await this.prisma.$transaction(async (tx) => {
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
          sedeId: stock.sedeId,
          empresaId,
          productoStockId,
          tipo: dto.tipo,
          tipoDocumento: dto.tipoDocumento,
          numeroDocumento: dto.numeroDocumento,
          cantidadAnterior: stock.stockActual,
          cantidad: dto.cantidad,
          cantidadNueva: nuevoStock,
          motivo: dto.motivo,
          observaciones: dto.observaciones,
          usuarioId,
        },
      });

      this.logger.log(
        `Stock ajustado: ${stock.producto?.nombre || stock.variante?.nombre} | Anterior: ${stock.stockActual} | Cambio: ${dto.cantidad} | Nuevo: ${nuevoStock}`,
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
              precio: true,
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              precio: true,
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

    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        productoId: productoId || null,
        varianteId: varianteId || null,
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
   * Valida si hay stock suficiente para vender un combo
   * Verifica que todos los componentes tengan stock disponible
   */
  async validarStockCombo(
    comboId: string,
    sedeId: string,
    empresaId: string,
    cantidad: number,
  ): Promise<{
    valido: boolean;
    faltantes: Array<{
      componenteId: string;
      componenteNombre: string;
      cantidadNecesaria: number;
      cantidadDisponible: number;
      faltante: number;
    }>;
  }> {
    // Obtener componentes del combo
    const componentes = await this.prisma.productoCombo.findMany({
      where: { comboId },
      include: {
        componenteProducto: {
          select: {
            id: true,
            nombre: true,
          },
        },
        componenteVariante: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    });

    const faltantes = [];

    for (const componente of componentes) {
      const cantidadNecesaria = componente.cantidad * cantidad;

      // Buscar stock del componente en la sede
      const stock = await this.prisma.productoStock.findFirst({
        where: {
          sedeId,
          empresaId,
          productoId: componente.componenteProductoId || undefined,
          varianteId: componente.componenteVarianteId || undefined,
        },
      });

      const stockDisponible = stock?.stockActual || 0;

      if (stockDisponible < cantidadNecesaria) {
        faltantes.push({
          componenteId:
            componente.componenteProductoId ||
            componente.componenteVarianteId ||
            '',
          componenteNombre:
            componente.componenteProducto?.nombre ||
            componente.componenteVariante?.nombre ||
            'Componente desconocido',
          cantidadNecesaria,
          cantidadDisponible: stockDisponible,
          faltante: cantidadNecesaria - stockDisponible,
        });
      }
    }

    return {
      valido: faltantes.length === 0,
      faltantes,
    };
  }

  /**
   * Descuenta stock de todos los componentes de un combo al vender
   * Debe ejecutarse en una transacción para garantizar atomicidad
   */
  async descontarStockCombo(
    comboId: string,
    sedeId: string,
    empresaId: string,
    cantidad: number,
    usuarioId: string,
    tipoDocumento?: string,
    numeroDocumento?: string,
  ) {
    // Primero validar que hay stock suficiente
    const validacion = await this.validarStockCombo(
      comboId,
      sedeId,
      empresaId,
      cantidad,
    );

    if (!validacion.valido) {
      const mensajeError = validacion.faltantes
        .map(
          (f) =>
            `${f.componenteNombre}: necesita ${f.cantidadNecesaria}, disponible ${f.cantidadDisponible}`,
        )
        .join('; ');

      throw new BadRequestException(
        `Stock insuficiente para vender el combo: ${mensajeError}`,
      );
    }

    // Descontar stock de cada componente en transacción
    return await this.prisma.$transaction(async (tx) => {
      const componentes = await tx.productoCombo.findMany({
        where: { comboId },
      });

      const movimientos = [];

      for (const componente of componentes) {
        const cantidadDescontar = componente.cantidad * cantidad;

        // Obtener stock actual
        const stock = await tx.productoStock.findFirst({
          where: {
            sedeId,
            empresaId,
            productoId: componente.componenteProductoId || undefined,
            varianteId: componente.componenteVarianteId || undefined,
          },
        });

        if (!stock) {
          throw new NotFoundException(
            `Stock no encontrado para componente ${componente.componenteProductoId || componente.componenteVarianteId}`,
          );
        }

        const nuevoStock = stock.stockActual - cantidadDescontar;

        // Actualizar stock
        await tx.productoStock.update({
          where: { id: stock.id },
          data: { stockActual: nuevoStock },
        });

        // Registrar movimiento
        const movimiento = await tx.movimientoStock.create({
          data: {
            sedeId,
            empresaId,
            productoStockId: stock.id,
            tipo: 'SALIDA_VENTA',
            tipoDocumento: tipoDocumento || 'VENTA_COMBO',
            numeroDocumento,
            cantidadAnterior: stock.stockActual,
            cantidad: -cantidadDescontar,
            cantidadNueva: nuevoStock,
            motivo: `Venta de combo (ID: ${comboId})`,
            observaciones: `Componente vendido como parte de combo. Cantidad de combos: ${cantidad}`,
            usuarioId,
          },
        });

        movimientos.push(movimiento);
      }

      this.logger.log(
        `Stock descontado para combo ${comboId}: ${cantidad} unidades vendidas`,
      );

      return movimientos;
    });
  }

  /**
   * Obtiene productos con stock bajo el mínimo
   */
  async getProductosBajoMinimo(empresaId: string, sedeId?: string) {
    const where: Prisma.ProductoStockWhereInput = {
      empresaId,
      stockMinimo: { not: null },
    };

    // Filtrar por sede si se proporciona
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

    // Filtrar aquellos donde stockActual <= stockMinimo
    const filtrados = productosBajos.filter(
      (p) => p.stockMinimo && p.stockActual <= p.stockMinimo,
    );

    return {
      productos: filtrados,
      total: filtrados.length,
      criticos: filtrados.filter((p) => p.stockActual === 0).length,
    };
  }
}
