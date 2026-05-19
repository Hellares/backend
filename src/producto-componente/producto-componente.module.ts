import { Module } from '@nestjs/common';
import { ProductoComponenteController } from './producto-componente.controller';
import { ProductoComponenteService } from './producto-componente.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ProductoComponenteController],
  providers: [ProductoComponenteService],
  exports: [ProductoComponenteService],
})
export class ProductoComponenteModule {}
