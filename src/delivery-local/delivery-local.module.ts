import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { DeliveryLocalService } from './delivery-local.service';
import { DeliveryLocalController } from './delivery-local.controller';

/**
 * Delivery local con repartidores propios (F1). WhatsappModule aporta
 * EvolutionApiService para avisar al cliente en cada transición.
 */
@Module({
  imports: [PrismaModule, NotificacionModule, WhatsappModule],
  controllers: [DeliveryLocalController],
  providers: [DeliveryLocalService],
  exports: [DeliveryLocalService],
})
export class DeliveryLocalModule {}
