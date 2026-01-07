import { Module } from '@nestjs/common';
import { ConfiguracionCodigosService } from './configuracion-codigos.service';
import { ConfiguracionCodigosController } from './configuracion-codigos.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, RedisModule, LoggerModule, AuthModule],
  controllers: [ConfiguracionCodigosController],
  providers: [ConfiguracionCodigosService],
  exports: [ConfiguracionCodigosService], // ⭐ Exportar para que otros módulos lo usen
})
export class ConfiguracionCodigosModule {}
