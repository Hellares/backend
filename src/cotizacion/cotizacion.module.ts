import { Module } from '@nestjs/common';
import { CotizacionController } from './cotizacion.controller';
import { CotizacionService } from './cotizacion.service';
import { CotizacionTasksService } from './cotizacion-tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { ProductoModule } from '../producto/producto.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    ConfiguracionCodigosModule,
    ProductoModule,
  ],
  controllers: [CotizacionController],
  providers: [CotizacionService, CotizacionTasksService, PlanLimitsService],
  exports: [CotizacionService],
})
export class CotizacionModule {}
