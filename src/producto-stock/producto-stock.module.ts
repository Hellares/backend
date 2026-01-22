import { Module } from '@nestjs/common';
import { ProductoStockController } from './producto-stock.controller';
import { ProductoStockService } from './producto-stock.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProductoStockController],
  providers: [ProductoStockService],
  exports: [ProductoStockService],
})
export class ProductoStockModule {}
