import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { SunatModule } from '../sunat/sunat.module';
import { GuiaRemisionService } from './guia-remision.service';
import { GuiaRemisionController } from './guia-remision.controller';
import { NubefactProvider } from '../sunat/providers/nubefact.provider';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, SunatModule],
  controllers: [GuiaRemisionController],
  providers: [GuiaRemisionService, NubefactProvider],
  exports: [GuiaRemisionService],
})
export class GuiaRemisionModule {}
