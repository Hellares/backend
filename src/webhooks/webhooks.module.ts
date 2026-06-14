import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { VentaModule } from '../venta/venta.module';
import { NotificacionModule } from '../notificacion/notificacion.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    IntegracionYapeModule,
    VentaModule,
    NotificacionModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
