import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegracionYapeService } from './integracion-yape.service';

@Module({
  imports: [PrismaModule],
  providers: [IntegracionYapeService],
  exports: [IntegracionYapeService],
})
export class IntegracionYapeModule {}
