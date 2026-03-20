import { Module } from '@nestjs/common';
import { DevolucionVentaController } from './devolucion-venta.controller';
import { DevolucionVentaService } from './devolucion-venta.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    CajaModule,
  ],
  controllers: [DevolucionVentaController],
  providers: [DevolucionVentaService],
  exports: [DevolucionVentaService],
})
export class DevolucionVentaModule {}
