import { Module } from '@nestjs/common';
import { VentaController } from './venta.controller';
import { VentaService } from './venta.service';
import { VentaAnalyticsController } from './analytics/venta-analytics.controller';
import { VentaAnalyticsService } from './analytics/venta-analytics.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    ConfiguracionCodigosModule,
  ],
  controllers: [VentaController, VentaAnalyticsController],
  providers: [VentaService, VentaAnalyticsService],
  exports: [VentaService],
})
export class VentaModule {}
