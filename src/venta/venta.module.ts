import { Module, forwardRef } from '@nestjs/common';
import { VentaController } from './venta.controller';
import { VentaService } from './venta.service';
import { VentaAnalyticsController } from './analytics/venta-analytics.controller';
import { VentaAnalyticsService } from './analytics/venta-analytics.service';
import { VentaYapeTasksService } from './venta-yape-tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { CajaModule } from '../caja/caja.module';
import { ProductoModule } from '../producto/producto.module';
import { SunatModule } from '../sunat/sunat.module';
import { ServicioModule } from '../servicio/servicio.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { CaracteristicaEmpresaModule } from '../caracteristica-empresa/caracteristica-empresa.module';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    ConfiguracionCodigosModule,
    forwardRef(() => CajaModule),
    ProductoModule,
    SunatModule,
    ServicioModule,
    IntegracionYapeModule,
    CaracteristicaEmpresaModule,
  ],
  controllers: [VentaAnalyticsController, VentaController],
  providers: [VentaService, VentaAnalyticsService, VentaYapeTasksService, SedeAccessGuard],
  exports: [VentaService],
})
export class VentaModule {}
