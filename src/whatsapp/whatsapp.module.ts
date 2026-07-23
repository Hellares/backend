import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { IaModule } from '../ia/ia.module';
import { VentaModule } from '../venta/venta.module';
import { EvolutionApiService } from './evolution-api.service';
import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappService } from './whatsapp.service';
import {
  WhatsappEmpresaController,
  WhatsappWebhookController,
} from './whatsapp.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ConsultasExternasModule,
    NotificacionModule,
    IntegracionYapeModule,
    IaModule,
    VentaModule,
  ],
  controllers: [WhatsappEmpresaController, WhatsappWebhookController],
  providers: [WhatsappService, EvolutionApiService, WhatsappBotService],
  // EvolutionApiService se exporta para módulos que avisan al cliente por
  // WhatsApp fuera del bot (ej. delivery local: "tu pedido va en camino").
  exports: [WhatsappService, EvolutionApiService],
})
export class WhatsappModule {}
