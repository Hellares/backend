import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { StorageModule } from '../storage/storage.module';
import { SorteosService } from './sorteos.service';
import {
  MisPremiosController,
  SorteosEmpresaController,
} from './sorteos.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificacionModule, StorageModule],
  controllers: [SorteosEmpresaController, MisPremiosController],
  providers: [SorteosService],
  exports: [SorteosService],
})
export class SorteosModule {}
