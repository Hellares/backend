import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { RedisHealthController } from './redis.health.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RedisHealthController],
  providers: [RedisService, CacheService],
  exports: [RedisService, CacheService],
})
export class RedisModule {}