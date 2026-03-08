import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { EstadoAviso, EstadoOrdenServicio } from '@prisma/client';

@Injectable()
export class AvisoMantenimientoTaskService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(AvisoMantenimientoTaskService.name);
  }

  /**
   * Genera avisos de mantenimiento para órdenes completadas.
   * Ejecuta todos los días a las 8 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleGenerateAvisos() {
    this.logger.info('Ejecutando generación de avisos de mantenimiento');

    try {
      // Obtener empresas con avisos habilitados
      const configs = await this.prisma.configuracionAvisoMantenimiento.findMany({
        where: { habilitado: true },
      });

      if (configs.length === 0) {
        this.logger.debug('No hay empresas con avisos habilitados');
        return;
      }

      let totalCreados = 0;

      for (const config of configs) {
        try {
          const creados = await this.generarAvisosParaEmpresa(config);
          totalCreados += creados;
        } catch (error) {
          this.logger.error(
            `Error generando avisos para empresa ${config.empresaId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (totalCreados > 0) {
        this.logger.info(`Se generaron ${totalCreados} aviso(s) de mantenimiento`);
      } else {
        this.logger.debug('No se generaron nuevos avisos');
      }
    } catch (error) {
      this.logger.error(
        'Error en tarea de generación de avisos',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Marca avisos cuya fecha recomendada ya llegó como NOTIFICADO.
   * Ejecuta todos los días a las 9 AM.
   */
  @Cron('0 9 * * *')
  async handleNotifyAvisos() {
    this.logger.info('Ejecutando notificación de avisos vencidos');

    try {
      const now = new Date();

      const result = await this.prisma.avisoMantenimiento.updateMany({
        where: {
          estado: EstadoAviso.PENDIENTE,
          fechaRecomendada: { lte: now },
        },
        data: {
          estado: EstadoAviso.NOTIFICADO,
          notificadoEn: now,
        },
      });

      if (result.count > 0) {
        this.logger.info(`Se notificaron ${result.count} aviso(s) vencidos`);
        // TODO: Integrar con servicio de push notifications cuando esté disponible
      }
    } catch (error) {
      this.logger.error(
        'Error al notificar avisos',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Genera avisos manualmente para una empresa sin restricción de ventana de anticipación.
   * Útil para generar avisos retroactivos sobre órdenes ya completadas.
   */
  async generarAvisosParaEmpresaManual(empresaId: string) {
    // Obtener o crear configuración con intervalos por defecto
    let config = await this.prisma.configuracionAvisoMantenimiento.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await this.prisma.configuracionAvisoMantenimiento.create({
        data: {
          empresaId,
          intervalos: {
            MANTENIMIENTO: 120,
            REPARACION: 180,
            LIMPIEZA: 90,
            INSTALACION: 365,
            ACTUALIZACION: 180,
          },
          diasAnticipacion: 7,
          habilitado: true,
        },
      });
    }

    const intervalos = config.intervalos as Record<string, number>;

    const ordenes = await this.prisma.ordenServicio.findMany({
      where: {
        empresaId,
        estado: {
          in: [EstadoOrdenServicio.ENTREGADO, EstadoOrdenServicio.FINALIZADO],
        },
        fechaEntrega: { not: null },
        incluirAvisoMantenimiento: true,
        avisosMantenimiento: {
          none: {
            estado: { in: [EstadoAviso.PENDIENTE, EstadoAviso.NOTIFICADO] },
          },
        },
      },
      select: {
        id: true,
        empresaId: true,
        clienteId: true,
        tipoServicio: true,
        tipoEquipo: true,
        marcaEquipo: true,
        fechaEntrega: true,
        actualizadoEn: true,
        fechaAvisoPersonalizado: true,
      },
    });

    let creados = 0;

    for (const orden of ordenes) {
      const fechaBase = orden.fechaEntrega ?? orden.actualizadoEn;
      let fechaRecomendada: Date;

      if (orden.fechaAvisoPersonalizado) {
        fechaRecomendada = orden.fechaAvisoPersonalizado;
      } else {
        const dias = intervalos[orden.tipoServicio];
        if (!dias) continue;
        fechaRecomendada = new Date(fechaBase.getTime() + dias * 24 * 60 * 60 * 1000);
      }

      const equipoParts = [orden.tipoEquipo, orden.marcaEquipo].filter(Boolean);

      await this.prisma.avisoMantenimiento.create({
        data: {
          empresaId: orden.empresaId,
          ordenServicioId: orden.id,
          clienteId: orden.clienteId,
          tipoServicio: orden.tipoServicio,
          equipoDescripcion: equipoParts.length > 0 ? equipoParts.join(' - ') : null,
          fechaUltimoServicio: fechaBase,
          fechaRecomendada,
        },
      });

      creados++;
    }

    this.logger.info(`Generación manual: ${creados} aviso(s) creados para empresa ${empresaId}`);

    return {
      message: `Se generaron ${creados} aviso(s) de mantenimiento`,
      totalCreados: creados,
      totalOrdenesEvaluadas: ordenes.length,
    };
  }

  private async generarAvisosParaEmpresa(config: {
    empresaId: string;
    intervalos: any;
    diasAnticipacion: number;
  }): Promise<number> {
    const intervalos = config.intervalos as Record<string, number>;
    const now = new Date();

    // Buscar órdenes completadas (ENTREGADO/FINALIZADO) con fecha de entrega
    // que NO tengan un aviso activo (PENDIENTE/NOTIFICADO)
    // y que estén incluidas en el sistema de avisos
    const ordenes = await this.prisma.ordenServicio.findMany({
      where: {
        empresaId: config.empresaId,
        estado: {
          in: [EstadoOrdenServicio.ENTREGADO, EstadoOrdenServicio.FINALIZADO],
        },
        fechaEntrega: { not: null },
        incluirAvisoMantenimiento: true,
        avisosMantenimiento: {
          none: {
            estado: { in: [EstadoAviso.PENDIENTE, EstadoAviso.NOTIFICADO] },
          },
        },
      },
      select: {
        id: true,
        empresaId: true,
        clienteId: true,
        tipoServicio: true,
        tipoEquipo: true,
        marcaEquipo: true,
        fechaEntrega: true,
        actualizadoEn: true,
        fechaAvisoPersonalizado: true,
      },
    });

    let creados = 0;

    for (const orden of ordenes) {
      const fechaBase = orden.fechaEntrega ?? orden.actualizadoEn;
      let fechaRecomendada: Date;

      if (orden.fechaAvisoPersonalizado) {
        fechaRecomendada = orden.fechaAvisoPersonalizado;
      } else {
        const dias = intervalos[orden.tipoServicio];
        if (!dias) continue;
        fechaRecomendada = new Date(fechaBase.getTime() + dias * 24 * 60 * 60 * 1000);
      }

      // Solo crear si estamos dentro del período de anticipación
      const fechaCreacion = new Date(fechaRecomendada.getTime() - config.diasAnticipacion * 24 * 60 * 60 * 1000);
      if (now < fechaCreacion) continue;

      const equipoParts = [orden.tipoEquipo, orden.marcaEquipo].filter(Boolean);

      await this.prisma.avisoMantenimiento.create({
        data: {
          empresaId: orden.empresaId,
          ordenServicioId: orden.id,
          clienteId: orden.clienteId,
          tipoServicio: orden.tipoServicio,
          equipoDescripcion: equipoParts.length > 0 ? equipoParts.join(' - ') : null,
          fechaUltimoServicio: fechaBase,
          fechaRecomendada,
        },
      });

      creados++;
    }

    return creados;
  }
}
