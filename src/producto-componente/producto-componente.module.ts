import { Module } from '@nestjs/common';
import { ProductoComponenteController } from './producto-componente.controller';
import { ProduccionController } from './produccion.controller';
import { ProductoComponenteService } from './producto-componente.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ProductoComponenteController, ProduccionController],
  providers: [ProductoComponenteService],
  exports: [ProductoComponenteService],
})
export class ProductoComponenteModule {}
