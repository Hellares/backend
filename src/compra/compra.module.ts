import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { OrdenCompraController } from './orden-compra/orden-compra.controller';
import { OrdenCompraService } from './orden-compra/orden-compra.service';
import { CompraController } from './compra/compra.controller';
import { CompraService } from './compra/compra.service';
import { LoteController } from './lote/lote.controller';
import { LoteService } from './lote/lote.service';

@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    ConfiguracionCodigosModule,
  ],
  controllers: [
    OrdenCompraController,
    CompraController,
    LoteController,
  ],
  providers: [
    OrdenCompraService,
    CompraService,
    LoteService,
  ],
  exports: [
    OrdenCompraService,
    CompraService,
    LoteService,
  ],
})
export class CompraModule {}
