import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EvolutionApiService } from './evolution-api.service';
import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappService } from './whatsapp.service';
import {
  WhatsappEmpresaController,
  WhatsappWebhookController,
} from './whatsapp.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WhatsappEmpresaController, WhatsappWebhookController],
  providers: [WhatsappService, EvolutionApiService, WhatsappBotService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
