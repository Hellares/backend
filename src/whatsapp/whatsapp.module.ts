import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { EvolutionApiService } from './evolution-api.service';
import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappService } from './whatsapp.service';
import {
  WhatsappEmpresaController,
  WhatsappWebhookController,
} from './whatsapp.controller';

@Module({
  imports: [PrismaModule, AuthModule, ConsultasExternasModule, NotificacionModule],
  controllers: [WhatsappEmpresaController, WhatsappWebhookController],
  providers: [WhatsappService, EvolutionApiService, WhatsappBotService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
