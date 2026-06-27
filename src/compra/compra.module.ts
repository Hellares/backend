import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { OrdenCompraController } from './orden-compra/orden-compra.controller';
import { OrdenCompraService } from './orden-compra/orden-compra.service';
import { CompraController } from './compra/compra.controller';
import { CompraService } from './compra/compra.service';
import { LoteController } from './lote/lote.controller';
import { LoteService } from './lote/lote.service';
import { CompraAnalyticsController } from './analytics/compra-analytics.controller';
import { CompraAnalyticsService } from './analytics/compra-analytics.service';
import { CompraAnalyticsExportService } from './analytics/compra-analytics-export.service';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    CajaModule,
    ConfiguracionCodigosModule,
    NotificacionModule,
  ],
  controllers: [
    OrdenCompraController,
    CompraController,
    LoteController,
    CompraAnalyticsController,
  ],
  providers: [
    OrdenCompraService,
    CompraService,
    LoteService,
    CompraAnalyticsService,
    CompraAnalyticsExportService,
  ],
  exports: [
    OrdenCompraService,
    CompraService,
    LoteService,
    CompraAnalyticsService,
  ],
})
export class CompraModule {}
