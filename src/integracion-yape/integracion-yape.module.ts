import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { IntegracionYapeService } from './integracion-yape.service';
import { IntegracionYapeController } from './integracion-yape.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [IntegracionYapeController],
  providers: [IntegracionYapeService],
  exports: [IntegracionYapeService],
})
export class IntegracionYapeModule {}
