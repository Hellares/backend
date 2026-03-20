import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MetaFinancieraController } from './meta-financiera.controller';
import { MetaFinancieraService } from './meta-financiera.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MetaFinancieraController],
  providers: [MetaFinancieraService],
})
export class MetaFinancieraModule {}
