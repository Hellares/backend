import { Module } from '@nestjs/common';
import { ArchivingService } from './archiving.service';
import { ArchivingController } from './archiving.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ArchivingService],
  controllers: [ArchivingController],
  exports: [ArchivingService],
})
export class ArchivingModule {}
