import { Module } from '@nestjs/common';
import { SedeController } from './sede.controller';
import { SedeService } from './sede.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, ConfiguracionCodigosModule],
  controllers: [SedeController],
  providers: [SedeService],
  exports: [SedeService],
})
export class SedeModule {}
