import { Module, forwardRef } from '@nestjs/common';
import { VentaController } from './venta.controller';
import { VentaService } from './venta.service';
import { VentaAnalyticsController } from './analytics/venta-analytics.controller';
import { VentaAnalyticsService } from './analytics/venta-analytics.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    ConfiguracionCodigosModule,
    forwardRef(() => CajaModule),
  ],
  controllers: [VentaController, VentaAnalyticsController],
  providers: [VentaService, VentaAnalyticsService],
  exports: [VentaService],
})
export class VentaModule {}
