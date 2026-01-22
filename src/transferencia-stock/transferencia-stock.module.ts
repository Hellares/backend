import { Module } from '@nestjs/common';
import { TransferenciaStockController } from './transferencia-stock.controller';
import { TransferenciaStockService } from './transferencia-stock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [PrismaModule, ConfiguracionCodigosModule],
  controllers: [TransferenciaStockController],
  providers: [TransferenciaStockService],
  exports: [TransferenciaStockService],
})
export class TransferenciaStockModule {}
