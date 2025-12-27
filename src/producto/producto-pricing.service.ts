import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AppLoggerService } from '../common/logger/logger.service';
import { PrecioNivelService } from './precio-nivel.service';
import { ConfiguracionPrecioService } from './configuracion-precio.service';

/**
 * Servicio especializado para gestión de precios
 * Responsabilidades:
 * - Sincronización de niveles de precio
 * - Migración de niveles a variantes
 * - Integración con PrecioNivelService y ConfiguracionPrecioService
 */
@Injectable()
export class ProductoPricingService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    // private precioNivelService: PrecioNivelService,
    // private configuracionPrecioService: ConfiguracionPrecioService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoPricingService.name);
  }

  // =====================================================
  // SINCRONIZACIÓN DE NIVELES
  // =====================================================

  /**
   * Sincroniza niveles de precio desde una configuración
   * Elimina físicamente los niveles anteriores y crea nuevos basados en la configuración
   * Nota: Se usa deleteMany en lugar de soft delete para evitar violaciones del constraint único (productoId, cantidadMinima)
   * @param productoId ID del producto
   * @param configuracionPrecioId ID de la configuración de precios
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   */
  async sincronizarNivelesDesdeConfiguracion(
    productoId: string,
    configuracionPrecioId: string,
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    this.logger.info('Sincronizando niveles desde configuración', {
      productoId,
      configuracionPrecioId,
    });

    // 1. Obtener niveles de la configuración
    const configuracion = await prisma.configuracionPrecio.findUnique({
      where: { id: configuracionPrecioId },
      include: {
        niveles: {
          orderBy: { orden: 'asc' },
        },
      },
    });

    if (!configuracion) {
      this.logger.warn(`Configuración ${configuracionPrecioId} no encontrada`);
      return;
    }

    if (!configuracion.niveles || configuracion.niveles.length === 0) {
      this.logger.warn(`Configuración ${configuracionPrecioId} no tiene niveles`);
      return;
    }

    // 2. Eliminar físicamente niveles anteriores del producto
    // (deleteMany en lugar de updateMany para evitar violación de constraint único)
    const deletedCount = await prisma.precioNivel.deleteMany({
      where: { productoId, varianteId: null },
    });

    this.logger.debug(`${deletedCount.count} niveles anteriores eliminados para producto ${productoId}`);

    // 3. Crear nuevos niveles basados en la configuración
    const nivelesParaCrear = configuracion.niveles.map((nivel, index) => ({
      productoId,
      varianteId: null,
      nombre: nivel.nombre,
      cantidadMinima: nivel.cantidadMinima,
      cantidadMaxima: nivel.cantidadMaxima,
      tipoPrecio: nivel.tipoPrecio,
      precio: null, // Se usa el precio del producto, no se copia desde la configuración
      porcentajeDesc: nivel.porcentajeDesc,
      descripcion: nivel.descripcion,
      orden: nivel.orden ?? index,
      isActive: true,
    }));

    await prisma.precioNivel.createMany({
      data: nivelesParaCrear,
    });

    this.logger.log(
      `${nivelesParaCrear.length} niveles sincronizados para producto ${productoId}`,
    );
  }

  // =====================================================
  // ELIMINACIÓN DE NIVELES
  // =====================================================

  /**
   * Elimina todos los niveles de precio de un producto
   * Eliminación física para evitar violaciones del constraint único (productoId, cantidadMinima)
   * @param productoId ID del producto
   * @param tx Transacción de Prisma (opcional)
   */
  async eliminarNivelesDeProducto(
    productoId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    const result = await prisma.precioNivel.deleteMany({
      where: { productoId, varianteId: null },
    });

    this.logger.info(`${result.count} niveles eliminados físicamente para producto ${productoId}`);
  }

  // =====================================================
  // MIGRACIÓN DE NIVELES
  // =====================================================

  /**
   * Migra niveles de precio de un producto base a una variante
   * Se usa cuando se convierte un producto simple a producto con variantes
   * Elimina físicamente los niveles del producto y crea nuevos para la variante
   * @param productoId ID del producto origen
   * @param varianteId ID de la variante destino
   * @param tx Transacción de Prisma (opcional)
   */
  async migrarNivelesProductoAVariante(
    productoId: string,
    varianteId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    // Obtener niveles del producto base (antes de eliminarlos)
    const nivelesProducto = await prisma.precioNivel.findMany({
      where: {
        productoId,
        varianteId: null,
      },
      orderBy: { orden: 'asc' },
    });

    if (nivelesProducto.length === 0) {
      this.logger.debug(
        `No hay niveles de precio para migrar del producto ${productoId} a variante ${varianteId}`,
      );
      return;
    }

    this.logger.info(
      `Migrando ${nivelesProducto.length} niveles de precio del producto ${productoId} a variante ${varianteId}`,
    );

    // Eliminar físicamente niveles del producto base (ya no se usarán)
    await prisma.precioNivel.deleteMany({
      where: {
        productoId,
        varianteId: null,
      },
    });

    // Crear nuevos niveles para la variante con los mismos datos
    const nivelesParaVariante = nivelesProducto.map((nivel) => ({
      varianteId,
      productoId: null, // Los niveles ahora pertenecen a la variante, no al producto
      nombre: nivel.nombre,
      cantidadMinima: nivel.cantidadMinima,
      cantidadMaxima: nivel.cantidadMaxima,
      tipoPrecio: nivel.tipoPrecio,
      precio: nivel.precio,
      porcentajeDesc: nivel.porcentajeDesc,
      descripcion: nivel.descripcion,
      orden: nivel.orden,
      isActive: true,
    }));

    await prisma.precioNivel.createMany({
      data: nivelesParaVariante,
    });

    this.logger.success(
      `${nivelesProducto.length} niveles de precio migrados exitosamente a variante ${varianteId}`,
    );
  }
}
