import { Module } from '@nestjs/common';
import { DevolucionVentaController } from './devolucion-venta.controller';
import { DevolucionVentaService } from './devolucion-venta.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';
@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    CajaModule,
    NotificacionModule,
  ],
  controllers: [DevolucionVentaController],
  providers: [DevolucionVentaService, SedeAccessGuard],
  exports: [DevolucionVentaService],
})
export class DevolucionVentaModule {}
