import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { VentaModule } from '../venta/venta.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { PedidoMarketplaceModule } from '../pedido-marketplace/pedido-marketplace.module';
import { CotizacionModule } from '../cotizacion/cotizacion.module';
import { SorteosModule } from '../sorteos/sorteos.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    IntegracionYapeModule,
    VentaModule,
    NotificacionModule,
    PedidoMarketplaceModule,
    CotizacionModule,
    SorteosModule,
    WhatsappModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
