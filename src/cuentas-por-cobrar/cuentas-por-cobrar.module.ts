import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { CuentasPorCobrarController } from './cuentas-por-cobrar.controller';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { CuentasPorCobrarTasksService } from './cuentas-por-cobrar-tasks.service';

@Module({
  imports: [PrismaModule, AuthModule, CajaModule, NotificacionModule],
  controllers: [CuentasPorCobrarController],
  providers: [CuentasPorCobrarService, CuentasPorCobrarTasksService],
  exports: [CuentasPorCobrarService],
})
export class CuentasPorCobrarModule {}
