import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { StorageModule } from '../storage/storage.module';
import { GastosRecurrentesController } from './gastos-recurrentes.controller';
import { GastosRecurrentesService } from './gastos-recurrentes.service';
import { GastosRecurrentesTasksService } from './gastos-recurrentes-tasks.service';

@Module({
  imports: [PrismaModule, AuthModule, NotificacionModule, StorageModule],
  controllers: [GastosRecurrentesController],
  providers: [GastosRecurrentesService, GastosRecurrentesTasksService],
  exports: [GastosRecurrentesService],
})
export class GastosRecurrentesModule {}
