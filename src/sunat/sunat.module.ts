import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { NubefactService } from './nubefact.service';
import { SunatController } from './sunat.controller';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [SunatController],
  providers: [NubefactService],
  exports: [NubefactService],
})
export class SunatModule {}
