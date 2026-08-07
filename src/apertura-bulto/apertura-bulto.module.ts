import { Module } from '@nestjs/common';
import { AperturaBultoController } from './apertura-bulto.controller';
import { AperturaBultoService } from './apertura-bulto.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AperturaBultoController],
  providers: [AperturaBultoService],
  exports: [AperturaBultoService],
})
export class AperturaBultoModule {}
