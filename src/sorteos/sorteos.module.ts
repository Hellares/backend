import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { StorageModule } from '../storage/storage.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ClientesModule } from '../clientes/clientes.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { SorteosService } from './sorteos.service';
import { SorteosAnalyticsService } from './sorteos-analytics.service';
import {
  MisPremiosController,
  SorteosEmpresaController,
} from './sorteos.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificacionModule,
    StorageModule,
    WhatsappModule,
    ClientesModule,
    ConsultasExternasModule,
    IntegracionYapeModule,
  ],
  controllers: [SorteosEmpresaController, MisPremiosController],
  providers: [SorteosService, SorteosAnalyticsService],
  exports: [SorteosService],
})
export class SorteosModule {}
