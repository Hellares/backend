import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { TipoNotificacion } from '@prisma/client';

@Injectable()
export class SolicitudCotizacionTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(SolicitudCotizacionTasksService.name);
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async expirarSolicitudesVencidas() {
    try {
      const now = new Date();

      // Backfill: set VENCIDA for old solicitudes that don't have fechaVencimiento
      await this.prisma.solicitudCotizacion.updateMany({
        where: {
          estado: { in: ['PENDIENTE', 'EN_REVISION'] },
          fechaVencimiento: null,
          creadoEn: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
        data: { estado: 'VENCIDA' },
      });

      // Find solicitudes that are PENDIENTE or EN_REVISION and past fechaVencimiento
      const vencidas = await this.prisma.solicitudCotizacion.findMany({
        where: {
          estado: { in: ['PENDIENTE', 'EN_REVISION'] },
          fechaVencimiento: { lte: now },
        },
        select: { id: true, codigo: true, solicitanteId: true, empresaId: true },
      });

      if (vencidas.length === 0) return;

      // Bulk update to VENCIDA
      await this.prisma.solicitudCotizacion.updateMany({
        where: {
          id: { in: vencidas.map((s) => s.id) },
        },
        data: { estado: 'VENCIDA' },
      });

      // Notify each solicitante
      for (const solicitud of vencidas) {
        try {
          await this.notificacionService.enviarAUsuario(
            solicitud.solicitanteId,
            'Solicitud vencida',
            `Tu solicitud de cotización #${solicitud.codigo} ha vencido después de 7 días sin respuesta.`,
            {
              tipo: TipoNotificacion.SISTEMA,
              empresaId: solicitud.empresaId,
              data: { solicitudId: solicitud.id },
              guardar: true,
            },
          );
        } catch (_) {}
      }

      this.logger.info(`${vencidas.length} solicitudes de cotización expiradas`);
    } catch (error) {
      this.logger.error(`Error expirando solicitudes: ${error.message}`);
    }
  }
}
