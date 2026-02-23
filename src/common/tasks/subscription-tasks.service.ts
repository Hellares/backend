import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../logger/logger.service';
import { EstadoSuscripcion } from '@prisma/client';

@Injectable()
export class SubscriptionTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(SubscriptionTasksService.name);
  }

  /**
   * Expira suscripciones vencidas (ejecuta a medianoche)
   * Busca empresas con fechaVencimiento pasada y estadoSuscripcion ACTIVA
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleSubscriptionExpiry() {
    this.logger.info('Ejecutando tarea de expiración de suscripciones');

    try {
      const now = new Date();

      const result = await this.prisma.empresa.updateMany({
        where: {
          fechaVencimiento: {
            lt: now,
          },
          estadoSuscripcion: EstadoSuscripcion.ACTIVA,
          deletedAt: null,
        },
        data: {
          estadoSuscripcion: EstadoSuscripcion.VENCIDA,
        },
      });

      if (result.count > 0) {
        this.logger.warn(
          `Se expiraron ${result.count} suscripción(es) vencida(s)`,
        );
      } else {
        this.logger.debug('No hay suscripciones vencidas para procesar');
      }
    } catch (error) {
      this.logger.error(
        'Error al procesar expiración de suscripciones',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Notifica suscripciones próximas a vencer (ejecuta a las 6 AM)
   * Busca empresas con fechaVencimiento entre ahora y ahora + 7 días
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleExpiryWarning() {
    this.logger.info('Ejecutando tarea de advertencia de vencimiento');

    try {
      const now = new Date();
      const sevenDaysFromNow = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      const empresasProximas = await this.prisma.empresa.findMany({
        where: {
          fechaVencimiento: {
            gte: now,
            lte: sevenDaysFromNow,
          },
          estadoSuscripcion: EstadoSuscripcion.ACTIVA,
          deletedAt: null,
        },
        select: {
          id: true,
          nombre: true,
          fechaVencimiento: true,
          planSuscripcion: {
            select: {
              nombre: true,
            },
          },
        },
      });

      if (empresasProximas.length > 0) {
        for (const empresa of empresasProximas) {
          const diasRestantes = Math.ceil(
            (empresa.fechaVencimiento!.getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24),
          );

          this.logger.warn(
            `Suscripción próxima a vencer: ${empresa.nombre} (plan: ${empresa.planSuscripcion?.nombre}) - ${diasRestantes} día(s) restantes`,
          );

          // TODO: Implementar envío de notificación por email cuando el servicio de emails esté disponible
        }
      } else {
        this.logger.debug(
          'No hay suscripciones próximas a vencer en los próximos 7 días',
        );
      }
    } catch (error) {
      this.logger.error(
        'Error al procesar advertencias de vencimiento',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
