import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoCambioPrecio } from '@prisma/client';
import { AppLoggerService } from '../common/logger';

/**
 * Servicio para gestionar el historial de cambios de precios
 *
 * Registra todos los cambios significativos en precios de productos y variantes
 * para auditoría, cumplimiento y análisis de tendencias.
 */
@Injectable()
export class ProductoPrecioHistorialService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoPrecioHistorialService.name);
  }

  /**
   * Registra un cambio de precio
   *
   * Solo registra si hubo un cambio real en el precio
   */
  async registrarCambio({
    productoId,
    varianteId,
    precioAnterior,
    precioNuevo,
    precioCostoAnterior,
    precioCostoNuevo,
    tipoCambio,
    razon,
    origenModulo,
    usuarioId,
  }: {
    productoId?: string;
    varianteId?: string;
    precioAnterior?: number;
    precioNuevo: number;
    precioCostoAnterior?: number;
    precioCostoNuevo?: number;
    tipoCambio: TipoCambioPrecio;
    razon?: string;
    origenModulo?: string;
    usuarioId: string;
  }) {
    // Validar que al menos un ID esté presente
    if (!productoId && !varianteId) {
      throw new Error('Debe proporcionar productoId o varianteId');
    }

    // Solo registrar si hubo cambio real en precio
    const huboCambioPrecio =
      precioAnterior !== undefined &&
      precioAnterior !== precioNuevo;

    const huboCambioCosto =
      precioCostoAnterior !== undefined &&
      precioCostoNuevo !== undefined &&
      precioCostoAnterior !== precioCostoNuevo;

    // Si no hubo ningún cambio, no registrar
    if (!huboCambioPrecio && !huboCambioCosto) {
      this.logger.debug('No se registra en historial: no hubo cambio de precio', {
        productoId,
        varianteId,
        precioAnterior,
        precioNuevo,
      });
      return null;
    }

    try {
      const registro = await this.prisma.productoPrecioHistorial.create({
        data: {
          productoId,
          varianteId,
          precioAnterior,
          precioNuevo,
          precioCostoAnterior,
          precioCostoNuevo,
          tipoCambio,
          razon: razon || this.generarRazonDefecto(tipoCambio),
          origenModulo: origenModulo || 'PRODUCTO',
          usuarioId,
        },
        include: {
          usuario: {
            select: {
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
      });

      this.logger.info('Cambio de precio registrado en historial', {
        id: registro.id,
        productoId,
        varianteId,
        tipoCambio,
        precioAnterior,
        precioNuevo,
      });

      return registro;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error al registrar cambio de precio en historial: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Obtiene el historial de precios de un producto
   */
  async getHistorial(productoId: string, varianteId?: string) {
    const where = varianteId
      ? { varianteId }
      : { productoId, varianteId: null };

    return await this.prisma.productoPrecioHistorial.findMany({
      where,
      include: {
        usuario: {
          select: {
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
    });
  }

  /**
   * Obtiene el último precio registrado
   */
  async getUltimoCambio(productoId: string, varianteId?: string) {
    const where = varianteId
      ? { varianteId }
      : { productoId, varianteId: null };

    return await this.prisma.productoPrecioHistorial.findFirst({
      where,
      include: {
        usuario: {
          select: {
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
    });
  }

  /**
   * Obtiene estadísticas de cambios de precio
   */
  async getEstadisticas(productoId: string, varianteId?: string) {
    const where = varianteId
      ? { varianteId }
      : { productoId, varianteId: null };

    const historial = await this.prisma.productoPrecioHistorial.findMany({
      where,
      orderBy: { creadoEn: 'asc' },
    });

    if (historial.length === 0) {
      return {
        totalCambios: 0,
        precioInicial: null,
        precioActual: null,
        variacionPorcentaje: null,
        promedioPrecios: null,
        precioMinimo: null,
        precioMaximo: null,
      };
    }

    const precios = historial.map((h) => h.precioNuevo.toNumber());
    const precioInicial = historial[0].precioAnterior?.toNumber() || historial[0].precioNuevo.toNumber();
    const precioActual = historial[historial.length - 1].precioNuevo.toNumber();

    const variacionPorcentaje = precioInicial
      ? ((precioActual - precioInicial) / precioInicial) * 100
      : 0;

    return {
      totalCambios: historial.length,
      precioInicial,
      precioActual,
      variacionPorcentaje: Number(variacionPorcentaje.toFixed(2)),
      promedioPrecios: Number((precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2)),
      precioMinimo: Math.min(...precios),
      precioMaximo: Math.max(...precios),
      cambiosPorTipo: this.agruparPorTipo(historial),
    };
  }

  /**
   * Genera una razón por defecto según el tipo de cambio
   */
  private generarRazonDefecto(tipoCambio: TipoCambioPrecio): string {
    const razones: Record<TipoCambioPrecio, string> = {
      MANUAL: 'Actualización manual del precio',
      OFERTA: 'Cambio relacionado con oferta',
      OFERTA_ACTIVADA: 'Oferta activada',
      OFERTA_DESACTIVADA: 'Oferta desactivada',
      COSTO: 'Actualización de precio de costo',
      COSTO_ACTUALIZADO: 'Actualización de precio de costo',
      MASIVO: 'Ajuste masivo de precios por sede',
      AJUSTE_MASIVO: 'Ajuste masivo de precios',
      AJUSTE_MERCADO: 'Ajuste por condiciones de mercado',
      COMPETENCIA: 'Ajuste por competencia',
      CORRECCION: 'Corrección de precio',
    };

    return razones[tipoCambio];
  }

  /**
   * Agrupa el historial por tipo de cambio
   */
  private agruparPorTipo(historial: any[]) {
    const agrupado: Record<string, number> = {};

    for (const registro of historial) {
      const tipo = registro.tipoCambio;
      agrupado[tipo] = (agrupado[tipo] || 0) + 1;
    }

    return agrupado;
  }
}
