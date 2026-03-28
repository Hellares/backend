import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { CloudinaryProvider } from './providers/cloudinary.provider';
import { ContaboProvider } from './providers/contabo.provider';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [StorageController],
  providers: [StorageService, CloudinaryProvider, ContaboProvider, PlanLimitsService],
  exports: [StorageService],
})
export class StorageModule {}
