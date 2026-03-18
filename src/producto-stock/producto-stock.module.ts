import { Module } from '@nestjs/common';
import { ProductoStockController } from './producto-stock.controller';
import { ProductoStockService } from './producto-stock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductoModule } from '../producto/producto.module';
import { PromocionModule } from '../promocion/promocion.module';

@Module({
  imports: [PrismaModule, ProductoModule, PromocionModule],
  controllers: [ProductoStockController],
  providers: [ProductoStockService],
  exports: [ProductoStockService],
})
export class ProductoStockModule {}
