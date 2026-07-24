import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RepartidoresService } from './repartidores.service';
import { RepartidoresController } from './repartidores.controller';

/**
 * Repartidores freelance de Syncronize (R1): registro con RENIEC
 * (ConsultasExternas), OTP y avisos por WhatsApp (Evolution).
 */
@Module({
  imports: [PrismaModule, ConsultasExternasModule, WhatsappModule],
  controllers: [RepartidoresController],
  providers: [RepartidoresService],
  exports: [RepartidoresService],
})
export class RepartidoresModule {}
